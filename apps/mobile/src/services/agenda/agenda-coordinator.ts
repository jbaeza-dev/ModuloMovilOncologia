import type { GatewayPayloadNotificacion, GatewayAcuse } from '@quimiocare/contracts';
import {
  upcomingAgendaOccurrences,
  parseOccurrenceId,
  reminderOccurrence,
} from '@quimiocare/contracts/agenda';
import type { SqlConnection } from '../../data/local/core/sql';
import { agendaRepository } from '../../data/agenda/agenda-repository';
import { enqueueOperational, type OperationalScope } from '../../data/agenda/operational-outbox';
import { isUuid, object } from '../session/response-checks';
export interface AgendaBinding extends OperationalScope {
  sessionId: string;
  installationId: string;
  contextKey: string;
  localPatientId: string;
}
export interface NativeAgendaData {
  quimiocare_agenda: 1;
  contexto: string;
  instalacion_id: string;
  canal: 'respaldo' | 'push';
  payload: GatewayPayloadNotificacion;
}
export interface AgendaNotifications {
  permission(): Promise<boolean>;
  list(): Promise<{ id: string; data: unknown }[]>;
  schedule(id: string, at: string | null, data: NativeAgendaData): Promise<string>;
  cancel(id: string): Promise<void>;
}
export interface AgendaCoverage {
  rearmedAt?: string | null;
  nativeIds: string[];
  permission: boolean;
  confirmed: number;
  wanted: number;
  truncated: number;
  until: string | null;
  horizonEndsAt: string;
  pendingCancellations: number;
  checkedAt: string;
}
interface Job {
  owner: string;
  environment: string;
  session_id: string;
  occurrence_id: string;
  payload_json: string;
  native_id: string;
  backup_at: string;
  state: string;
  processed_at: string | null;
  claim_id: string | null;
  claim_until: string | null;
}
export function notificationPayload(value: unknown): value is GatewayPayloadNotificacion {
  if (
    !object(value) ||
    value.tipo !== 'recordatorio' ||
    !isUuid(value.sesion_id) ||
    !isUuid(value.recordatorio_id) ||
    !Number.isSafeInteger(value.version_recordatorio) ||
    Number(value.version_recordatorio) < 1 ||
    typeof value.ocurrencia_id !== 'string'
  )
    return false;
  const keys = [
    'tipo',
    'sesion_id',
    'recordatorio_id',
    'version_recordatorio',
    'ocurrencia_id',
    'programado_en',
    'respaldo_en',
    'vence_en',
  ];
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    !['programado_en', 'respaldo_en', 'vence_en'].every(
      (k) => typeof value[k] === 'string' && Number.isFinite(Date.parse(value[k] as string)),
    )
  )
    return false;
  const parsed = parseOccurrenceId(value.ocurrencia_id);
  return (
    !!parsed &&
    parsed.id === value.recordatorio_id &&
    parsed.version === value.version_recordatorio &&
    Date.parse(value.respaldo_en as string) - Date.parse(value.programado_en as string) ===
      120000 &&
    Date.parse(value.vence_en as string) - Date.parse(value.programado_en as string) === 600000
  );
}
export function localAgendaData(value: unknown): value is NativeAgendaData {
  return (
    object(value) &&
    value.quimiocare_agenda === 1 &&
    typeof value.contexto === 'string' &&
    isUuid(value.instalacion_id) &&
    ['respaldo', 'push'].includes(String(value.canal)) &&
    notificationPayload(value.payload)
  );
}
export class AgendaCoordinator {
  private needsNativeRefresh = true;
  private lastRearmedAt: string | null = null;
  private inactive = false;
  private serial: Promise<unknown> = Promise.resolve();
  readonly repository: ReturnType<typeof agendaRepository>;
  private readonly keys: string[];
  constructor(
    private readonly db: SqlConnection,
    readonly binding: AgendaBinding,
    private readonly native: AgendaNotifications,
    private readonly assertContext: () => void,
    private readonly uuid: () => string,
    private readonly now = () => new Date().toISOString(),
  ) {
    const live = assertContext;
    this.assertContext = () => {
      live();
      if (this.inactive) throw new Error('Coordinador de agenda cerrado.');
    };
    this.keys = [binding.owner, binding.environment, binding.sessionId];
    this.repository = agendaRepository(db, binding, assertContext, now);
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.serial.then(action);
    this.serial = next.catch(() => undefined);
    return next;
  }
  private data(
    payload: GatewayPayloadNotificacion,
    channel: NativeAgendaData['canal'],
  ): NativeAgendaData {
    return {
      quimiocare_agenda: 1,
      contexto: this.binding.contextKey,
      instalacion_id: this.binding.installationId,
      canal: channel,
      payload,
    };
  }
  private matches(data: NativeAgendaData) {
    return (
      data.contexto === this.binding.contextKey &&
      data.instalacion_id === this.binding.installationId &&
      data.payload.sesion_id === this.binding.sessionId
    );
  }
  private async cancel(job: Job) {
    await this.db.run(
      "UPDATE qc_agenda_job SET state='cancel_pending' WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?",
      [...this.keys, job.occurrence_id],
    );
    try {
      await this.native.cancel(job.native_id);
      await this.db.run(
        "UPDATE qc_agenda_job SET state='cancelled',claim_id=NULL,claim_until=NULL WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?",
        [...this.keys, job.occurrence_id],
      );
      return true;
    } catch {
      return false;
    }
  }
  reconcile() {
    return this.exclusive(async () => {
      this.assertContext();
      const at = this.now(),
        snapshot = await this.repository.read(),
        window = upcomingAgendaOccurrences(snapshot.rules, at, snapshot.completed),
        permission = await this.native.permission();
      this.assertContext();
      let native = await this.native.list();
      this.assertContext();
      const desired = new Map(window.occurrences.map((v) => [v.ocurrencia_id, v]));
      const jobs = await this.db.all<Job>(
        'SELECT * FROM qc_agenda_job WHERE owner=? AND environment=? AND session_id=?',
        this.keys,
      );
      let failed = 0;
      for (const job of jobs) {
        if (job.state === 'cancelled' && !desired.has(job.occurrence_id)) continue;
        if (job.processed_at || ['observed', 'expired'].includes(job.state)) {
          desired.delete(job.occurrence_id);
          if (native.some((v) => v.id === job.native_id) && !(await this.cancel(job))) failed++;
          continue;
        }
        if (!permission || !desired.has(job.occurrence_id) || job.state === 'cancel_pending') {
          if (!(await this.cancel(job))) failed++;
        }
      }
      // Retire known legacy jobs from this same local owner, keeping their history and failed cancellations.
      for (const item of native) {
        if (
          object(item.data) &&
          item.data.version === 1 &&
          item.data.pacienteId === this.binding.localPatientId
        ) {
          try {
            await this.native.cancel(item.id);
            await this.db.run(
              "UPDATE notificacion_local SET estado='cancelada',id_nativo=NULL WHERE paciente_id=? AND id_nativo=?",
              [this.binding.localPatientId, item.id],
            );
          } catch {
            failed++;
          }
        }
      }
      // Expo's list is persisted requests, not proof that alarms survived force-stop.
      const refreshNative = this.needsNativeRefresh;
      const unverified = new Set<string>(refreshNative ? [...desired.keys()] : []);
      if (permission && !failed)
        for (const occurrence of desired.values()) {
          this.assertContext();
          const old = jobs.find((v) => v.occurrence_id === occurrence.ocurrencia_id);
          if (old?.state === 'processing' && old.claim_until && old.claim_until > at) continue;
          const payload: GatewayPayloadNotificacion = {
            tipo: 'recordatorio',
            sesion_id: this.binding.sessionId,
            recordatorio_id: occurrence.recordatorio_id,
            version_recordatorio: occurrence.version_recordatorio,
            ocurrencia_id: occurrence.ocurrencia_id,
            programado_en: occurrence.programado_en,
            respaldo_en: occurrence.respaldo_en,
            vence_en: occurrence.vence_en,
          };
          const id =
            old?.native_id ??
            'qc06:' + this.binding.sessionId + ':' + occurrence.ocurrencia_id + ':backup';
          if (!old)
            await this.db.run(
              "INSERT INTO qc_agenda_job(owner,environment,session_id,occurrence_id,payload_json,native_id,backup_at,state) VALUES(?,?,?,?,?,?,?,'planned')",
              [
                ...this.keys,
                occurrence.ocurrencia_id,
                JSON.stringify(payload),
                id,
                occurrence.respaldo_en,
              ],
            );
          if (refreshNative || !native.some((v) => v.id === id)) {
            unverified.add(occurrence.ocurrencia_id);
            try {
              const actual = await this.native.schedule(
                id,
                occurrence.respaldo_en,
                this.data(payload, 'respaldo'),
              );
              if (actual !== id) throw new Error('Identificador nativo inesperado.');
              this.assertContext();
              await this.db.run(
                "UPDATE qc_agenda_job SET state='scheduled',claim_id=NULL,claim_until=NULL WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?",
                [...this.keys, occurrence.ocurrencia_id],
              );
              unverified.delete(occurrence.ocurrencia_id);
            } catch {
              this.assertContext();
              this.needsNativeRefresh = true;
            }
          }
        }
      native = await this.native.list();
      this.assertContext();
      const confirmed = window.occurrences.filter(
        (v) =>
          permission &&
          !unverified.has(v.ocurrencia_id) &&
          desired.has(v.ocurrencia_id) &&
          native.some(
            (n) => n.id === 'qc06:' + this.binding.sessionId + ':' + v.ocurrencia_id + ':backup',
          ),
      );
      if (permission && !failed && unverified.size === 0) {
        this.needsNativeRefresh = false;
        if (refreshNative) this.lastRearmedAt = this.now();
      }
      const result: AgendaCoverage = {
        rearmedAt: this.lastRearmedAt,
        nativeIds: confirmed.map(
          (v) => 'qc06:' + this.binding.sessionId + ':' + v.ocurrencia_id + ':backup',
        ),
        permission,
        confirmed: confirmed.length,
        wanted: desired.size,
        truncated: window.truncated,
        until: confirmed.at(-1)?.respaldo_en ?? null,
        horizonEndsAt: window.horizonEndsAt,
        pendingCancellations: failed,
        checkedAt: this.now(),
      };
      await this.db.run(
        'INSERT INTO qc_agenda_coverage(owner,environment,session_id,value_json) VALUES(?,?,?,?) ON CONFLICT(owner,environment,session_id) DO UPDATE SET value_json=excluded.value_json',
        [...this.keys, JSON.stringify(result)],
      );
      return result;
    });
  }
  private async observation(
    tx: SqlConnection,
    payload: GatewayPayloadNotificacion,
    event: GatewayAcuse['evento'],
    at: string,
  ) {
    const old = await tx.first(
      'SELECT operation_id FROM qc_agenda_observation WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=? AND event=?',
      [...this.keys, payload.ocurrencia_id, event],
    );
    if (old) return;
    const id = this.uuid();
    await tx.run(
      'INSERT INTO qc_agenda_observation(owner,environment,session_id,occurrence_id,event,operation_id) VALUES(?,?,?,?,?,?)',
      [...this.keys, payload.ocurrencia_id, event, id],
    );
    await enqueueOperational(
      tx,
      this.binding,
      'receipt',
      {
        operacion_id: id,
        sesion_id: this.binding.sessionId,
        ocurrencia_id: payload.ocurrencia_id,
        evento: event,
        ocurrido_en: at,
      },
      at,
    );
  }
  private async valid(payload: GatewayPayloadNotificacion, allowExpired = false) {
    this.assertContext();
    if (!notificationPayload(payload) || payload.sesion_id !== this.binding.sessionId) return false;
    const parsed = parseOccurrenceId(payload.ocurrencia_id)!,
      snapshot = await this.repository.read(),
      rule = snapshot.rules.find((v) => v.id === payload.recordatorio_id);
    if (
      !rule ||
      rule.version !== payload.version_recordatorio ||
      (rule.tipo !== 'medicacion' && snapshot.completed.has(rule.tipo + ':' + parsed.date))
    )
      return false;
    const expected = reminderOccurrence(rule, parsed.date, parsed.time);
    return (
      !!expected &&
      expected.programado_en === payload.programado_en &&
      expected.respaldo_en === payload.respaldo_en &&
      expected.vence_en === payload.vence_en &&
      (allowExpired || Date.parse(this.now()) < Date.parse(payload.vence_en))
    );
  }
  processPush(payload: unknown) {
    return this.exclusive(async () => {
      if (!notificationPayload(payload) || !(await this.valid(payload)))
        return 'discarded' as const;
      const at = this.now();
      if (Date.parse(at) < Date.parse(payload.programado_en)) return 'discarded' as const;
      // Late pushes do not cancel the backup or present another notification.
      if (Date.parse(at) >= Date.parse(payload.respaldo_en)) {
        await this.db.transaction((tx) => this.observation(tx, payload, 'push_procesado', at));
        return 'late' as const;
      }
      if (!(await this.native.permission())) return 'permission' as const;
      this.assertContext();
      let job: Job | null = null;
      const claim = this.uuid();
      await this.db.transaction(async (tx) => {
        this.assertContext();
        let current = await tx.first<Job>(
          'SELECT * FROM qc_agenda_job WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?',
          [...this.keys, payload.ocurrencia_id],
        );
        if (!current) {
          await tx.run(
            "INSERT INTO qc_agenda_job(owner,environment,session_id,occurrence_id,payload_json,native_id,backup_at,state) VALUES(?,?,?,?,?,?,?,'planned')",
            [
              ...this.keys,
              payload.ocurrencia_id,
              JSON.stringify(payload),
              'qc06:' + this.binding.sessionId + ':' + payload.ocurrencia_id + ':backup',
              payload.respaldo_en,
            ],
          );
          current = await tx.first<Job>(
            'SELECT * FROM qc_agenda_job WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?',
            [...this.keys, payload.ocurrencia_id],
          );
        }
        if (
          !current ||
          current.processed_at ||
          ['processed', 'observed', 'cancel_pending', 'expired'].includes(current.state) ||
          (current.state === 'processing' && current.claim_until && current.claim_until > at)
        )
          return;
        await tx.run(
          "UPDATE qc_agenda_job SET state='processing',claim_id=?,claim_until=? WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?",
          [
            claim,
            new Date(Date.parse(at) + 30000).toISOString(),
            ...this.keys,
            payload.ocurrencia_id,
          ],
        );
        job = current;
      });
      if (!job) return 'duplicate' as const;
      try {
        if (
          !(await this.valid(payload)) ||
          Date.parse(this.now()) >= Date.parse(payload.respaldo_en)
        )
          throw new Error('Contexto o ventana cambió.');
        this.assertContext();
        const pushId = 'qc06:' + this.binding.sessionId + ':' + payload.ocurrencia_id + ':push';
        await this.native.schedule(pushId, null, this.data(payload, 'push'));
        this.assertContext();
        // Only the client's real handling cancels its persisted backup; a provider ticket never calls this.
        await this.db.transaction(async (tx) => {
          this.assertContext();
          const owned = await tx.first<{ claim_id: string }>(
            'SELECT claim_id FROM qc_agenda_job WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?',
            [...this.keys, payload.ocurrencia_id],
          );
          if (owned?.claim_id !== claim) throw new Error('Otro manejador tomó la ocurrencia.');
          await tx.run(
            "UPDATE qc_agenda_job SET state='processed',processed_at=?,claim_id=NULL,claim_until=NULL WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?",
            [this.now(), ...this.keys, payload.ocurrencia_id],
          );
          await this.observation(tx, payload, 'push_procesado', this.now());
        });
        try {
          await this.native.cancel((job as Job).native_id);
        } catch {
          await this.db.run(
            "UPDATE qc_agenda_job SET state='cancel_pending' WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?",
            [...this.keys, payload.ocurrencia_id],
          );
        }
        return 'presented' as const;
      } catch (error) {
        await this.db.run(
          "UPDATE qc_agenda_job SET state='scheduled',claim_id=NULL,claim_until=NULL WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=? AND claim_id=?",
          [...this.keys, payload.ocurrencia_id, claim],
        );
        throw error;
      }
    });
  }
  observe(data: unknown, event: 'received' | 'opened') {
    return this.exclusive(async () => {
      if (!localAgendaData(data) || !this.matches(data) || !(await this.valid(data.payload, true)))
        return null;
      const job = await this.db.first<Job>(
        'SELECT * FROM qc_agenda_job WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?',
        [...this.keys, data.payload.ocurrencia_id],
      );
      if (!job) return null;
      const at = this.now();
      await this.db.transaction(async (tx) => {
        this.assertContext();
        if (data.canal === 'respaldo') {
          await this.observation(tx, data.payload, 'respaldo_observado', at);
          await tx.run(
            "UPDATE qc_agenda_job SET state='observed' WHERE owner=? AND environment=? AND session_id=? AND occurrence_id=?",
            [...this.keys, data.payload.ocurrencia_id],
          );
        }
        if (event === 'opened') await this.observation(tx, data.payload, 'abierto', at);
      });
      const snapshot = await this.repository.read(),
        rule = snapshot.rules.find((v) => v.id === data.payload.recordatorio_id);
      return event === 'opened'
        ? rule?.tipo === 'signos'
          ? '/vitales/registrar'
          : rule?.tipo === 'epro'
            ? '/formulario'
            : '/perfil/medicacion'
        : null;
    });
  }
  close() {
    this.inactive = true;
    return this.exclusive(async () => {
      const jobs = await this.db.all<Job>(
        "SELECT * FROM qc_agenda_job WHERE owner=? AND environment=? AND session_id=? AND state NOT IN ('cancelled','expired')",
        this.keys,
      );
      let failed = 0;
      for (const job of jobs) {
        if (!(await this.cancel(job))) failed++;
        try {
          await this.native.cancel(
            'qc06:' + this.binding.sessionId + ':' + job.occurrence_id + ':push',
          );
        } catch {
          failed++;
        }
      }
      if (failed) throw new Error('Quedan avisos pendientes de cancelar de la cuenta anterior.');
    });
  }
  async coverage() {
    this.assertContext();
    const row = await this.db.first<{ value_json: string }>(
      'SELECT value_json FROM qc_agenda_coverage WHERE owner=? AND environment=? AND session_id=?',
      this.keys,
    );
    return row ? (JSON.parse(row.value_json) as AgendaCoverage) : null;
  }
  deactivate() {
    this.inactive = true;
  }
}
