import type {
  GatewayAgenda,
  GatewayConfiguracionRecordatorio,
  GatewayRecordatorioEnvelope,
  GatewayEstadoDiario,
  GatewayRecordatorio,
} from '@quimiocare/contracts';
import type { SqlConnection } from '../local/core/sql';
import type { OperationalScope, OperationalEvent } from './operational-outbox';
import { normalizedReminder, validReminderDates } from '@quimiocare/contracts/agenda';
export type AgendaIntent = {
  id: string;
  kind: 'create' | 'replace' | 'delete';
  body_json: string;
  state: 'pending' | 'conflict';
  created_at: string;
};
export function agendaRepository(
  db: SqlConnection,
  scope: OperationalScope,
  assertContext: () => void,
  now = () => new Date().toISOString(),
) {
  const keys = [scope.owner, scope.environment];
  async function snapshot(value: GatewayAgenda) {
    let applied = false;
    assertContext();
    await db.transaction(async (tx) => {
      assertContext();
      const old = await tx.first<{ version: number }>(
        'SELECT version FROM qc_agenda_state WHERE owner=? AND environment=?',
        keys,
      );
      if (old && value.version_agenda < old.version) return;
      await tx.run('DELETE FROM qc_agenda_rule WHERE owner=? AND environment=?', keys);
      for (const rule of value.recordatorios)
        await tx.run('INSERT INTO qc_agenda_rule(owner,environment,id,rule_json) VALUES(?,?,?,?)', [
          ...keys,
          rule.id,
          JSON.stringify(rule),
        ]);
      await tx.run(
        'DELETE FROM qc_agenda_daily WHERE owner=? AND environment=? AND local_date BETWEEN ? AND ?',
        [...keys, value.desde, value.hasta],
      );
      for (const day of value.cumplimientos)
        await tx.run(
          'INSERT OR IGNORE INTO qc_agenda_daily(owner,environment,kind,local_date) VALUES(?,?,?,?)',
          [...keys, day.tipo_registro, day.fecha_local],
        );
      await tx.run(
        'INSERT INTO qc_agenda_state(owner,environment,version,server_time,synchronized_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,environment) DO UPDATE SET version=excluded.version,server_time=excluded.server_time,synchronized_at=excluded.synchronized_at',
        [...keys, value.version_agenda, value.hora_servidor, now()],
      );
      applied = true;
    });
    assertContext();
    return applied;
  }
  return {
    snapshot,
    async read() {
      assertContext();
      const state = await db.first<{
        version: number;
        server_time: string;
        synchronized_at: string;
      }>(
        'SELECT version,server_time,synchronized_at FROM qc_agenda_state WHERE owner=? AND environment=?',
        keys,
      );
      const rules = (
        await db.all<{ rule_json: string }>(
          'SELECT rule_json FROM qc_agenda_rule WHERE owner=? AND environment=? ORDER BY id',
          keys,
        )
      ).map((v) => JSON.parse(v.rule_json) as GatewayRecordatorio);
      const days = await db.all<{ kind: GatewayEstadoDiario['tipo_registro']; local_date: string }>(
        'SELECT kind,local_date FROM qc_agenda_daily WHERE owner=? AND environment=?',
        keys,
      );
      const completed = new Set(days.map((v) => v.kind + ':' + v.local_date));
      // A durable SAVE remains complete even if clinical upload is pending/rejected or later deleted.
      const local = await db.all<OperationalEvent>(
        "SELECT * FROM qc_gateway_outbox WHERE owner=? AND environment=? AND kind='completion'",
        keys,
      );
      for (const row of local) {
        const body = JSON.parse(row.body_json);
        completed.add(body.tipo_registro + ':' + body.fecha_local);
      }
      assertContext();
      return { state, rules, completed };
    },
    async acknowledge(value: GatewayRecordatorioEnvelope, id: string) {
      assertContext();
      await db.transaction(async (tx) => {
        assertContext();
        const state = await tx.first<{ version: number }>(
          'SELECT version FROM qc_agenda_state WHERE owner=? AND environment=?',
          keys,
        );
        if (!state || value.version_agenda >= state.version) {
          await tx.run(
            'INSERT INTO qc_agenda_rule(owner,environment,id,rule_json) VALUES(?,?,?,?) ON CONFLICT(owner,environment,id) DO UPDATE SET rule_json=excluded.rule_json',
            [...keys, value.recordatorio.id, JSON.stringify(value.recordatorio)],
          );
          await tx.run(
            'INSERT INTO qc_agenda_state(owner,environment,version,server_time,synchronized_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,environment) DO UPDATE SET version=excluded.version,server_time=excluded.server_time,synchronized_at=excluded.synchronized_at',
            [...keys, value.version_agenda, value.hora_servidor, now()],
          );
        }
        await tx.run('DELETE FROM qc_agenda_intent WHERE owner=? AND environment=? AND id=?', [
          ...keys,
          id,
        ]);
      });
    },
    async acknowledgeDelete(id: string) {
      assertContext();
      await db.transaction(async (tx) => {
        assertContext();
        await tx.run('DELETE FROM qc_agenda_rule WHERE owner=? AND environment=? AND id=?', [
          ...keys,
          id,
        ]);
        await tx.run('DELETE FROM qc_agenda_intent WHERE owner=? AND environment=? AND id=?', [
          ...keys,
          id,
        ]);
      });
    },
    async intent(id: string, kind: AgendaIntent['kind'], body: unknown) {
      assertContext();
      await db.transaction(async (tx) => {
        assertContext();
        const old = await tx.first<AgendaIntent>(
          'SELECT * FROM qc_agenda_intent WHERE owner=? AND environment=? AND id=?',
          [...keys, id],
        );
        if (old)
          throw new Error(
            'Hay una intención anterior pendiente; revisa su estado antes de editar.',
          );
        await tx.run(
          "INSERT INTO qc_agenda_intent(owner,environment,id,kind,body_json,state,created_at) VALUES(?,?,?,?,?,'pending',?)",
          [...keys, id, kind, JSON.stringify(body), now()],
        );
      });
    },
    intents: () =>
      db.all<AgendaIntent>(
        'SELECT * FROM qc_agenda_intent WHERE owner=? AND environment=? ORDER BY created_at,id',
        keys,
      ),
    async conflict(id: string) {
      assertContext();
      await db.run(
        "UPDATE qc_agenda_intent SET state='conflict' WHERE owner=? AND environment=? AND id=?",
        [...keys, id],
      );
    },
    async discardIntent(id: string) {
      assertContext();
      await db.run('DELETE FROM qc_agenda_intent WHERE owner=? AND environment=? AND id=?', [
        ...keys,
        id,
      ]);
    },
  };
}
export function validConfiguration(value: unknown): value is GatewayConfiguracionRecordatorio {
  if (!value || typeof value !== 'object') return false;
  const v = value as GatewayConfiguracionRecordatorio;
  return (
    ['epro', 'signos', 'medicacion'].includes(v.tipo) &&
    typeof v.titulo === 'string' &&
    [...v.titulo].length >= 1 &&
    [...v.titulo].length <= 80 &&
    v.zona_horaria === 'America/Santiago' &&
    Array.isArray(v.horas) &&
    v.horas.length >= 1 &&
    v.horas.length <= 8 &&
    v.horas.every((h) => typeof h === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(h)) &&
    new Set(v.horas).size === v.horas.length &&
    Array.isArray(v.dias_semana) &&
    v.dias_semana.length >= 1 &&
    v.dias_semana.length <= 7 &&
    v.dias_semana.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) &&
    new Set(v.dias_semana).size === v.dias_semana.length &&
    typeof v.fecha_inicio === 'string' &&
    (v.fecha_fin === null || typeof v.fecha_fin === 'string') &&
    typeof v.activo === 'boolean' &&
    validReminderDates(v)
  );
}
export function sameConfiguration(
  left: GatewayConfiguracionRecordatorio,
  right: GatewayConfiguracionRecordatorio,
) {
  return JSON.stringify(normalizedReminder(left)) === JSON.stringify(normalizedReminder(right));
}
