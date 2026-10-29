import type {
  GatewayAgenda,
  GatewayConfiguracionRecordatorio,
  GatewayRecordatorio,
  GatewayRecordatorioEnvelope,
} from '@quimiocare/contracts';
import { AGENDA_POLICY, validCivilDate } from '@quimiocare/contracts/agenda';
import type { HttpSessionAdapter } from '../session/http-session-adapter';
import { SessionFailure } from '../session/http-session-types';
import { isUuid, object } from '../session/response-checks';
import {
  agendaRepository,
  validConfiguration,
  sameConfiguration,
  type AgendaIntent,
} from '../../data/agenda/agenda-repository';
import type { SqlConnection } from '../../data/local/core/sql';
import { operationalOutbox } from '../../data/agenda/operational-outbox';
const stamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 1;
function reminder(v: unknown): GatewayRecordatorio {
  if (
    !object(v) ||
    !isUuid(v.id) ||
    !positive(v.version) ||
    !stamp(v.creado_en) ||
    !stamp(v.actualizado_en) ||
    v.canal !== 'push_con_respaldo_local' ||
    v.respaldo_segundos !== 120 ||
    !validConfiguration(v)
  )
    throw new SessionFailure('invalid');
  return v as unknown as GatewayRecordatorio;
}
function envelope(v: unknown) {
  if (!object(v) || !positive(v.version_agenda) || !stamp(v.hora_servidor))
    throw new SessionFailure('invalid');
  return {
    recordatorio: reminder(v.recordatorio),
    version_agenda: v.version_agenda as number,
    hora_servidor: v.hora_servidor,
  } satisfies GatewayRecordatorioEnvelope;
}
function snapshot(v: unknown): GatewayAgenda {
  if (
    !object(v) ||
    !positive(v.version_agenda) ||
    !stamp(v.hora_servidor) ||
    typeof v.desde !== 'string' ||
    typeof v.hasta !== 'string' ||
    !validCivilDate(v.desde) ||
    !validCivilDate(v.hasta) ||
    v.hasta < v.desde ||
    Date.parse(v.hasta) - Date.parse(v.desde) > 30 * 86400000 ||
    !Array.isArray(v.recordatorios) ||
    v.recordatorios.length > 100 ||
    !Array.isArray(v.cumplimientos) ||
    !object(v.politica) ||
    Object.entries(AGENDA_POLICY).some(
      ([k, value]) => (v.politica as Record<string, unknown>)[k] !== value,
    )
  )
    throw new SessionFailure('invalid');
  const rules = v.recordatorios.map(reminder);
  if (new Set(rules.map((r) => r.id)).size !== rules.length) throw new SessionFailure('invalid');
  for (const d of v.cumplimientos)
    if (
      !object(d) ||
      !['epro', 'signos'].includes(String(d.tipo_registro)) ||
      typeof d.fecha_local !== 'string' ||
      !validCivilDate(d.fecha_local) ||
      d.fecha_local < v.desde ||
      d.fecha_local > v.hasta ||
      d.zona_horaria !== 'America/Santiago' ||
      d.cumplido !== true
    )
      throw new SessionFailure('invalid');
  return { ...v, recordatorios: rules } as unknown as GatewayAgenda;
}
export class AgendaClient {
  readonly repository: ReturnType<typeof agendaRepository>;
  readonly outbox: ReturnType<typeof operationalOutbox>;
  private readonly owner: string;
  private readonly signal: AbortSignal;
  private serial: Promise<unknown> = Promise.resolve();
  private refreshing: Promise<Awaited<ReturnType<AgendaClient['read']>>> | null = null;
  constructor(
    private readonly session: HttpSessionAdapter,
    db: SqlConnection,
    environment: string,
  ) {
    const owner = session.getCurrentUser()?.id;
    if (!owner) throw new SessionFailure('expired');
    this.owner = owner;
    this.signal = session.getContextSignal();
    const scope = { owner, environment };
    this.repository = agendaRepository(db, scope, () => this.assert());
    this.outbox = operationalOutbox(
      db,
      scope,
      async (kind, body) =>
        this.request(
          kind === 'completion' ? '/recordatorios/cumplimientos' : '/notificaciones/acuses',
          'POST',
          body,
        ),
      () => this.assert(),
    );
  }
  assert() {
    if (this.signal.aborted || this.session.getCurrentUser()?.id !== this.owner)
      throw new SessionFailure('changed');
  }
  private async request(path: string, method = 'GET', body?: unknown) {
    this.assert();
    const result = await this.session.request('gateway', '/api/gateway' + path, method, body, {
      signal: this.signal,
      retryUnauthorized: method === 'GET',
      preserveServiceErrors: true,
    });
    this.assert();
    return result;
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const job = this.serial.then(action);
    this.serial = job.catch(() => undefined);
    return job;
  }
  private async synchronize() {
    await this.outbox.flush();
    this.assert();
    const r = await this.request('/recordatorios');
    if (r.status !== 200) throw new SessionFailure('unavailable', r.status);
    await this.repository.snapshot(snapshot(r.body));
    return this.repository.read();
  }
  refresh() {
    return (this.refreshing ??= this.exclusive(() => this.synchronize()).finally(() => {
      this.refreshing = null;
    }));
  }
  async read() {
    return this.repository.read();
  }
  save(id: string, config: GatewayConfiguracionRecordatorio, version?: number) {
    return this.exclusive(async () => {
      this.assert();
      if (
        !isUuid(id) ||
        !validConfiguration(config) ||
        (version !== undefined && !positive(version))
      )
        throw new SessionFailure('invalid');
      const kind = version === undefined ? 'create' : 'replace',
        body = version === undefined ? { id, ...config } : { ...config, version_esperada: version };
      await this.repository.intent(id, kind, body);
      return this.submit({
        id,
        kind,
        body_json: JSON.stringify(body),
        state: 'pending',
        created_at: new Date().toISOString(),
      });
    });
  }
  remove(id: string, version: number) {
    return this.exclusive(async () => {
      this.assert();
      if (!isUuid(id) || !positive(version)) throw new SessionFailure('invalid');
      const body = { version_esperada: version };
      await this.repository.intent(id, 'delete', body);
      return this.submit({
        id,
        kind: 'delete',
        body_json: JSON.stringify(body),
        state: 'pending',
        created_at: new Date().toISOString(),
      });
    });
  }
  recover(id: string) {
    return this.exclusive(async () => {
      const intent = (await this.repository.intents()).find((v) => v.id === id);
      if (!intent) throw new Error('No hay una intención pendiente.');
      if (intent.state === 'conflict') throw new SessionFailure('conflict', 409);
      return this.submit(intent, true);
    });
  }
  private async submit(intent: AgendaIntent, recoverOnly = false): Promise<void> {
    const body = JSON.parse(intent.body_json),
      path = '/recordatorios/' + intent.id;
    if (recoverOnly && intent.kind === 'replace') return this.recoverReplace(intent);
    try {
      const r = await this.request(
        intent.kind === 'create'
          ? '/recordatorios'
          : path + (intent.kind === 'delete' ? '?version_esperada=' + body.version_esperada : ''),
        intent.kind === 'create' ? 'POST' : intent.kind === 'replace' ? 'PUT' : 'DELETE',
        intent.kind === 'delete' ? undefined : body,
      );
      if (r.status === 409) {
        await this.repository.conflict(intent.id);
        throw new SessionFailure('conflict', 409);
      }
      if (intent.kind === 'delete' && r.status === 204) {
        await this.repository.acknowledgeDelete(intent.id);
      } else if (intent.kind !== 'delete' && [200, 201].includes(r.status)) {
        const value = envelope(r.body);
        if (value.recordatorio.id !== intent.id || !sameConfiguration(value.recordatorio, body))
          throw new SessionFailure('invalid');
        await this.repository.acknowledge(value, intent.id);
      } else throw new SessionFailure('unavailable', r.status);
    } catch (error) {
      this.assert();
      if (error instanceof SessionFailure && error.kind === 'conflict') throw error;
      if (intent.kind === 'replace') return this.recoverReplace(intent);
      throw error;
    }
    // The ACK is already durable even if the follow-up snapshot is temporarily unavailable.
    try {
      await this.synchronize();
    } catch {
      this.assert();
    }
  }
  private async recoverReplace(intent: AgendaIntent) {
    const body = JSON.parse(intent.body_json),
      r = await this.request('/recordatorios/' + intent.id);
    if (r.status !== 200) throw new SessionFailure('unavailable', r.status);
    const value = envelope(r.body);
    if (
      value.recordatorio.id === intent.id &&
      sameConfiguration(value.recordatorio, body) &&
      [body.version_esperada, body.version_esperada + 1].includes(value.recordatorio.version)
    ) {
      await this.repository.acknowledge(value, intent.id);
      return;
    }
    await this.repository.conflict(intent.id);
    throw new SessionFailure('conflict', 409);
  }
}
