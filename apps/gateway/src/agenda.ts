import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { validateRequest } from '@quimiocare/contracts';
import type {
  GatewayAgenda,
  GatewayConfiguracionRecordatorio,
  GatewayCrearRecordatorio,
  GatewayReemplazarRecordatorio,
  GatewayRecordatorio,
  GatewayRecordatorioEnvelope,
  GatewayRegistrarCumplimientos,
  GatewayResultadoCumplimientos,
  GatewayRegistrarAcuses,
  GatewayResultadoAcuses,
} from '@quimiocare/contracts';
import {
  AGENDA_POLICY,
  agendaDate,
  normalizedReminder,
  parseOccurrenceId,
  reminderOccurrence,
  shiftAgendaDate,
  validCivilDate,
  validReminderDates,
} from '@quimiocare/contracts/agenda';
import { transaction, type Database } from './persistence/database.js';
import { GatewayError } from './http/errors.js';

export interface ReminderRow {
  id: string;
  owner_id: string;
  kind: GatewayRecordatorio['tipo'];
  title: string;
  timezone: 'America/Santiago';
  hours: string[];
  weekdays: number[];
  starts_on: string;
  ends_on: string | null;
  active: boolean;
  version: number;
  create_hash: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}
const fields = 'r.*,r.starts_on::text AS starts_on,r.ends_on::text AS ends_on';
const invalid = () => new GatewayError(422, 'DATOS_INVALIDOS');
const conflict = () => new GatewayError(409, 'OPERACION_EN_CONFLICTO');
const missing = () => new GatewayError(404, 'RECORDATORIO_NO_ENCONTRADO');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function lockAgenda(client: PoolClient, owner: string): Promise<void> {
  await client.query(
    'INSERT INTO gw_agenda(owner_id,version) VALUES($1,1) ON CONFLICT DO NOTHING',
    [owner],
  );
  await client.query('SELECT owner_id FROM gw_agenda WHERE owner_id=$1 FOR UPDATE', [owner]);
  await client.query('UPDATE gw_agenda SET version=1 WHERE owner_id=$1 AND version=0', [owner]);
}
async function agendaVersion(client: PoolClient, owner: string): Promise<number> {
  const value = Number(
    (
      await client.query<{ version: string }>('SELECT version FROM gw_agenda WHERE owner_id=$1', [
        owner,
      ])
    ).rows[0]!.version,
  );
  if (!Number.isSafeInteger(value) || value < 1) throw new GatewayError(500, 'ERROR_SERVIDOR');
  return value;
}
async function bump(client: PoolClient, owner: string) {
  await client.query('UPDATE gw_agenda SET version=GREATEST(version,1)+1 WHERE owner_id=$1', [
    owner,
  ]);
}
export function reminderView(row: ReminderRow): GatewayRecordatorio {
  return {
    id: row.id,
    tipo: row.kind,
    titulo: row.title,
    zona_horaria: row.timezone,
    horas: row.hours.map((h) => h.slice(0, 5)).sort(),
    dias_semana: [...row.weekdays].sort((a, b) => a - b),
    fecha_inicio: row.starts_on,
    fecha_fin: row.ends_on,
    activo: row.active,
    version: row.version,
    creado_en: row.created_at.toISOString(),
    actualizado_en: row.updated_at.toISOString(),
    canal: 'push_con_respaldo_local',
    respaldo_segundos: 120,
  };
}
async function revision(client: PoolClient, rule: GatewayRecordatorio, owner: string) {
  await client.query(
    'INSERT INTO gw_reminder_revision(owner_id,reminder_id,version,configuration) VALUES($1,$2,$3,$4::jsonb)',
    [owner, rule.id, rule.version, JSON.stringify(normalizedReminder(rule))],
  );
}
async function cancelRule(client: PoolClient, owner: string, id: string) {
  await client.query(
    "UPDATE gw_dispatch SET status='cancelled',next_attempt_at=NULL WHERE owner_id=$1 AND reminder_id=$2 AND status IN ('reserved','retry','sending')",
    [owner, id],
  );
}
function values(config: GatewayConfiguracionRecordatorio) {
  return [
    config.tipo,
    config.titulo,
    config.zona_horaria,
    config.horas,
    config.dias_semana,
    config.fecha_inicio,
    config.fecha_fin,
    config.activo,
  ];
}
function duplicates(items: { operacion_id: string }[]) {
  return new Set(items.map((item) => item.operacion_id.toLowerCase())).size !== items.length;
}
async function guardConflicts<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw conflict();
    throw error;
  }
}
export function agendaStore(db: Database, maximum = 100, now: () => Date = () => new Date()) {
  const stamp = () => now().toISOString();
  const envelope = async (
    client: PoolClient,
    owner: string,
    row: ReminderRow,
  ): Promise<GatewayRecordatorioEnvelope> => ({
    recordatorio: reminderView(row),
    version_agenda: await agendaVersion(client, owner),
    hora_servidor: stamp(),
  });
  async function owned(client: PoolClient, owner: string, id: string, includeDeleted = false) {
    const row = (
      await client.query<ReminderRow>(
        `SELECT ${fields} FROM gw_reminder r WHERE r.owner_id=$1 AND r.id=$2`,
        [owner, id],
      )
    ).rows[0];
    if (!row || (!includeDeleted && row.deleted_at)) throw missing();
    return row;
  }
  return {
    async list(owner: string, desde?: string, hasta?: string): Promise<GatewayAgenda> {
      if ((desde === undefined) !== (hasta === undefined)) throw invalid();
      const today = agendaDate(stamp());
      const start = desde ?? shiftAgendaDate(today, -7),
        end = hasta ?? shiftAgendaDate(today, 7);
      if (
        !validCivilDate(start) ||
        !validCivilDate(end) ||
        end < start ||
        Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z') > 30 * 86400000
      )
        throw invalid();
      return transaction(db, async (client) => {
        await lockAgenda(client, owner);
        const reminders = await client.query<ReminderRow>(
          `SELECT ${fields} FROM gw_reminder r WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`,
          [owner],
        );
        const completed = await client.query<{
          kind: 'epro' | 'signos';
          date: string;
          timezone: 'America/Santiago';
        }>(
          'SELECT kind,local_date::text AS date,timezone FROM gw_daily_state WHERE owner_id=$1 AND local_date BETWEEN $2::date AND $3::date ORDER BY local_date,kind',
          [owner, start, end],
        );
        return {
          version_agenda: await agendaVersion(client, owner),
          hora_servidor: stamp(),
          desde: start,
          hasta: end,
          recordatorios: reminders.rows.map(reminderView),
          cumplimientos: completed.rows.map((row) => ({
            tipo_registro: row.kind,
            fecha_local: row.date,
            zona_horaria: row.timezone,
            cumplido: true as const,
          })),
          politica: AGENDA_POLICY,
        };
      });
    },
    async get(owner: string, id: string) {
      return transaction(db, async (client) => {
        await lockAgenda(client, owner);
        return envelope(client, owner, await owned(client, owner, id));
      });
    },
    async create(owner: string, input: GatewayCrearRecordatorio) {
      if (!validateRequest('G-08', { body: input }).valid || !validReminderDates(input))
        throw invalid();
      const config = normalizedReminder(input),
        id = input.id.toLowerCase(),
        fingerprint = hash({ owner, id, config });
      return guardConflicts(() =>
        transaction(db, async (client) => {
          await lockAgenda(client, owner);
          const prior = (
            await client.query<ReminderRow>(`SELECT ${fields} FROM gw_reminder r WHERE id=$1`, [id])
          ).rows[0];
          if (prior) {
            if (
              prior.owner_id !== owner ||
              prior.deleted_at ||
              prior.version !== 1 ||
              prior.create_hash !== fingerprint
            )
              throw conflict();
            return { status: 200 as const, body: await envelope(client, owner, prior) };
          }
          const count = Number(
            (
              await client.query<{ count: string }>(
                'SELECT count(*) FROM gw_reminder WHERE owner_id=$1 AND deleted_at IS NULL',
                [owner],
              )
            ).rows[0]!.count,
          );
          if (count >= maximum) throw invalid();
          const inserted = await client.query(
            'INSERT INTO gw_reminder(id,owner_id,kind,title,timezone,hours,weekdays,starts_on,ends_on,active,version,create_hash) VALUES($1,$2,$3,$4,$5,$6::time[],$7::smallint[],$8::date,$9::date,$10,1,$11) ON CONFLICT(id) DO NOTHING RETURNING id',
            [id, owner, ...values(config), fingerprint],
          );
          if (!inserted.rowCount) throw conflict();
          const row = await owned(client, owner, id);
          await revision(client, reminderView(row), owner);
          await bump(client, owner);
          return { status: 201 as const, body: await envelope(client, owner, row) };
        }),
      );
    },
    async replace(owner: string, id: string, input: GatewayReemplazarRecordatorio) {
      if (
        !validateRequest('G-10', { body: input, path: { id } }).valid ||
        !validReminderDates(input)
      )
        throw invalid();
      const config = normalizedReminder(input);
      return transaction(db, async (client) => {
        await lockAgenda(client, owner);
        const current = await owned(client, owner, id);
        if (current.version !== input.version_esperada)
          throw new GatewayError(409, 'VERSION_EN_CONFLICTO');
        if (JSON.stringify(normalizedReminder(reminderView(current))) === JSON.stringify(config))
          return envelope(client, owner, current);
        await client.query(
          'UPDATE gw_reminder SET kind=$3,title=$4,timezone=$5,hours=$6::time[],weekdays=$7::smallint[],starts_on=$8::date,ends_on=$9::date,active=$10,version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2',
          [owner, id, ...values(config)],
        );
        const row = await owned(client, owner, id);
        await revision(client, reminderView(row), owner);
        await cancelRule(client, owner, id);
        await bump(client, owner);
        return envelope(client, owner, row);
      });
    },
    async remove(owner: string, id: string, version: number) {
      return transaction(db, async (client) => {
        await lockAgenda(client, owner);
        const row = await owned(client, owner, id, true);
        if (row.deleted_at) return;
        if (row.version !== version) throw new GatewayError(409, 'VERSION_EN_CONFLICTO');
        await client.query(
          'UPDATE gw_reminder SET deleted_at=now(),updated_at=now() WHERE owner_id=$1 AND id=$2',
          [owner, id],
        );
        await cancelRule(client, owner, id);
        await bump(client, owner);
      });
    },
    async complete(
      owner: string,
      body: GatewayRegistrarCumplimientos,
    ): Promise<GatewayResultadoCumplimientos> {
      if (!validateRequest('G-12', { body }).valid || duplicates(body.items)) throw invalid();
      const timestamp = now().getTime();
      for (const item of body.items)
        if (
          Date.parse(item.registrado_en) > timestamp + 300000 ||
          agendaDate(item.registrado_en) !== item.fecha_local
        )
          throw invalid();
      return guardConflicts(() =>
        transaction(db, async (client) => {
          await lockAgenda(client, owner);
          const results = new Map<string, 'registrado' | 'replay'>();
          for (const item of [...body.items].sort((a, b) =>
            a.operacion_id.toLowerCase().localeCompare(b.operacion_id.toLowerCase()),
          )) {
            const id = item.operacion_id.toLowerCase(),
              registered = new Date(item.registrado_en).toISOString();
            const fingerprint = hash({
              owner,
              tipo_registro: item.tipo_registro,
              fecha_local: item.fecha_local,
              zona_horaria: item.zona_horaria,
              registrado_en: registered,
            });
            const prior = (
              await client.query<{ owner_id: string; request_hash: string }>(
                'SELECT owner_id,request_hash FROM gw_completion_event WHERE operation_id=$1',
                [id],
              )
            ).rows[0];
            if (prior) {
              if (prior.owner_id !== owner || prior.request_hash !== fingerprint) throw conflict();
              results.set(id, 'replay');
              continue;
            }
            await client.query(
              'INSERT INTO gw_completion_event(operation_id,owner_id,kind,local_date,timezone,registered_at,request_hash) VALUES($1,$2,$3,$4::date,$5,$6,$7)',
              [
                id,
                owner,
                item.tipo_registro,
                item.fecha_local,
                item.zona_horaria,
                registered,
                fingerprint,
              ],
            );
            const effective = await client.query(
              'INSERT INTO gw_daily_state(owner_id,kind,local_date,timezone,completed_at) VALUES($1,$2,$3::date,$4,$5) ON CONFLICT DO NOTHING RETURNING owner_id',
              [owner, item.tipo_registro, item.fecha_local, item.zona_horaria, registered],
            );
            if (effective.rowCount) {
              await bump(client, owner);
              await client.query(
                "UPDATE gw_dispatch d SET status='cancelled',next_attempt_at=NULL FROM gw_reminder r WHERE d.owner_id=$1 AND d.reminder_id=r.id AND r.kind=$2 AND (d.scheduled_at AT TIME ZONE $3)::date=$4::date AND d.status IN ('reserved','retry','sending')",
                [owner, item.tipo_registro, item.zona_horaria, item.fecha_local],
              );
            }
            results.set(id, 'registrado');
          }
          return {
            items: body.items.map((item) => ({
              operacion_id: item.operacion_id.toLowerCase(),
              resultado: results.get(item.operacion_id.toLowerCase())!,
            })),
            version_agenda: await agendaVersion(client, owner),
            hora_servidor: stamp(),
          };
        }),
      );
    },
    async acknowledge(
      owner: string,
      body: GatewayRegistrarAcuses,
    ): Promise<GatewayResultadoAcuses> {
      if (
        !validateRequest('G-13', { body }).valid ||
        duplicates(body.items) ||
        body.items.some((item) => Date.parse(item.ocurrido_en) > now().getTime() + 300000)
      )
        throw invalid();
      return guardConflicts(() =>
        transaction(db, async (client) => {
          await lockAgenda(client, owner);
          const results = new Map<string, 'registrado' | 'replay'>();
          for (const item of [...body.items].sort((a, b) =>
            a.operacion_id.toLowerCase().localeCompare(b.operacion_id.toLowerCase()),
          )) {
            const id = item.operacion_id.toLowerCase(),
              session = item.sesion_id.toLowerCase(),
              at = new Date(item.ocurrido_en).toISOString();
            const fingerprint = hash({
              owner,
              sesion_id: session,
              ocurrencia_id: item.ocurrencia_id,
              evento: item.evento,
              ocurrido_en: at,
            });
            const prior = (
              await client.query<{ owner_id: string; request_hash: string }>(
                'SELECT owner_id,request_hash FROM gw_receipt WHERE operation_id=$1',
                [id],
              )
            ).rows[0];
            if (prior) {
              if (prior.owner_id !== owner || prior.request_hash !== fingerprint) throw conflict();
              results.set(id, 'replay');
              continue;
            }
            const occurrence = parseOccurrenceId(item.ocurrencia_id);
            if (!occurrence) throw invalid();
            const device = await client.query(
              'SELECT id FROM gw_device WHERE owner_id=$1 AND id=$2',
              [owner, session],
            );
            const history = (
              await client.query<{ configuration: GatewayConfiguracionRecordatorio }>(
                'SELECT configuration FROM gw_reminder_revision WHERE owner_id=$1 AND reminder_id=$2 AND version=$3',
                [owner, occurrence.id, occurrence.version],
              )
            ).rows[0];
            if (!device.rowCount || !history) throw invalid();
            const rule: GatewayRecordatorio = {
              ...history.configuration,
              id: occurrence.id,
              version: occurrence.version,
              creado_en: at,
              actualizado_en: at,
              canal: 'push_con_respaldo_local',
              respaldo_segundos: 120,
            };
            if (!reminderOccurrence(rule, occurrence.date, occurrence.time)) throw invalid();
            await client.query(
              'INSERT INTO gw_receipt(operation_id,owner_id,occurrence_id,session_id,event,occurred_at,request_hash,reminder_id,reminder_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
              [
                id,
                owner,
                item.ocurrencia_id,
                session,
                item.evento,
                at,
                fingerprint,
                occurrence.id,
                occurrence.version,
              ],
            );
            results.set(id, 'registrado');
          }
          return {
            items: body.items.map((item) => ({
              operacion_id: item.operacion_id.toLowerCase(),
              resultado: results.get(item.operacion_id.toLowerCase())!,
            })),
            hora_servidor: stamp(),
          };
        }),
      );
    },
  };
}
