import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  GatewayRecordatorio,
  GatewayAgenda,
  GatewayPayloadNotificacion,
} from '@quimiocare/contracts';
import { AGENDA_POLICY, reminderOccurrence } from '@quimiocare/contracts/agenda';
import { createSqliteTestHarness } from '../../data/local/testing/sqlite-test-harness';
import { migrateDatabase } from '../../data/local/migrations';
import { enqueueOperational } from '../../data/agenda/operational-outbox';
import {
  AgendaCoordinator,
  notificationPayload,
  type AgendaBinding,
  type AgendaNotifications,
  type NativeAgendaData,
} from './agenda-coordinator';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const binding: AgendaBinding = {
  owner: '964d32f1-6941-579f-9f08-b60342194da9',
  environment: 'demo:coordinator',
  localPatientId: '11111111-1111-4111-8111-111111111111',
  sessionId: '33333333-3333-4333-8333-333333333333',
  installationId: '44444444-4444-4444-8444-444444444444',
  contextKey: 'synthetic-context-hash',
};
const rule: GatewayRecordatorio = {
  id: 'ed21a163-0102-4b25-98af-4b3552cc87ad',
  tipo: 'signos',
  titulo: 'Signos',
  zona_horaria: 'America/Santiago',
  horas: ['08:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
  version: 1,
  creado_en: '2026-10-01T00:00:00Z',
  actualizado_en: '2026-10-01T00:00:00Z',
  canal: 'push_con_respaldo_local',
  respaldo_segundos: 120,
};
class Native implements AgendaNotifications {
  alarms = new Set<string>();
  allowed = true;
  failSchedule = false;
  failCancel = false;
  pending = new Map<string, { data: NativeAgendaData; at: string | null }>();
  presentations = 0;
  cancelled: string[] = [];
  async permission() {
    return this.allowed;
  }
  async list() {
    return [...this.pending].map(([id, v]) => ({ id, data: v.data }));
  }
  async schedule(id: string, at: string | null, data: NativeAgendaData) {
    if (this.failSchedule) throw new Error('schedule failed');
    if (at === null) this.presentations++;
    this.pending.set(id, { data, at });
    if (at !== null) this.alarms.add(id);
    return id;
  }
  async cancel(id: string) {
    if (this.failCancel) throw new Error('cancel failed');
    this.cancelled.push(id);
    this.pending.delete(id);
    this.alarms.delete(id);
  }
}
async function setup(rules = [rule]) {
  const db = harness.open();
  await migrateDatabase(db);
  const native = new Native();
  let now = '2026-10-29T10:59:00Z',
    active = true;
  const create = () =>
      new AgendaCoordinator(
        db,
        binding,
        native,
        () => {
          if (!active) throw new Error('changed');
        },
        randomUUID,
        () => now,
      ),
    coordinator = create();
  const snapshot = (version = 1): GatewayAgenda => ({
    version_agenda: version,
    hora_servidor: now,
    desde: '2026-10-28',
    hasta: '2026-11-01',
    recordatorios: rules,
    cumplimientos: [],
    politica: AGENDA_POLICY,
  });
  await coordinator.repository.snapshot(snapshot());
  const o = reminderOccurrence(rule, '2026-10-29', '08:00')!;
  const payload: GatewayPayloadNotificacion = {
    tipo: 'recordatorio',
    sesion_id: binding.sessionId,
    recordatorio_id: rule.id,
    version_recordatorio: 1,
    ocurrencia_id: o.ocurrencia_id,
    programado_en: o.programado_en,
    respaldo_en: o.respaldo_en,
    vence_en: o.vence_en,
  };
  return {
    db,
    native,
    coordinator,
    create,
    payload,
    snapshot,
    setNow: (v: string) => {
      now = v;
    },
    close: () => {
      active = false;
    },
  };
}
describe('Push y respaldo local de agenda (lógica; aceptación Android aparte)', () => {
  it('rearma al reabrir aunque Expo conserve los IDs de alarmas borradas por force-stop', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    s.native.alarms.clear();
    expect(s.native.pending.size).toBe(14);
    const reopened = s.create();
    expect((await reopened.reconcile()).confirmed).toBe(14);
    expect(s.native.alarms.size).toBe(14);
    expect(s.native.pending.size).toBe(14);
  });
  it('no acredita cobertura por preferencias guardadas si falla el rearme nativo', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    s.native.alarms.clear();
    s.native.failSchedule = true;
    expect(await s.create().reconcile()).toMatchObject({ confirmed: 0, until: null });
    expect(s.native.pending.size).toBe(14);
    expect(s.native.alarms.size).toBe(0);
  });
  it('programa solo las 64 más próximas, nominal+120s, y conserva cobertura real', async () => {
    const dense = {
      ...rule,
      horas: ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    };
    const s = await setup([dense]);
    const result = await s.coordinator.reconcile();
    expect(result.confirmed).toBe(64);
    expect(result.truncated).toBe(48);
    expect(s.native.pending.size).toBe(64);
    const first = [...s.native.pending.values()][0]!;
    expect(first.at).toBe('2026-10-29T11:02:00.000Z');
    expect((await s.coordinator.coverage())?.until).toBe(result.until);
    await s.coordinator.reconcile();
    expect(s.native.pending.size).toBe(64);
  });
  it('no inventa cobertura cuando la programación nativa falla', async () => {
    const s = await setup();
    s.native.failSchedule = true;
    const result = await s.coordinator.reconcile();
    expect(result.confirmed).toBe(0);
    expect(result.until).toBeNull();
    expect(await s.db.first('SELECT count(*) AS n FROM qc_gateway_outbox')).toEqual({ n: 0 });
  });
  it('mantiene respaldo hasta procesar push y deduplica entre dos coordinadores', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    const before = s.native.cancelled.length;
    s.setNow('2026-10-29T11:00:10Z');
    const result = await Promise.all([
      s.coordinator.processPush(s.payload),
      s.create().processPush(s.payload),
    ]);
    expect(result.sort()).toEqual(['duplicate', 'presented']);
    expect(s.native.presentations).toBe(1);
    expect(s.native.cancelled.length).toBe(before + 1);
    const rows = await s.db.all<{ body_json: string }>('SELECT body_json FROM qc_gateway_outbox');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.body_json).evento).toBe('push_procesado');
    await s.coordinator.reconcile();
    expect(s.native.pending.size).toBe(14); // 13 future backups + one already presented native notice.
  });
  it('un push tardío no presenta ni cancela el respaldo y su acuse es idempotente', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    s.setNow('2026-10-29T11:02:00Z');
    expect(await s.coordinator.processPush(s.payload)).toBe('late');
    await s.coordinator.processPush(s.payload);
    expect(s.native.presentations).toBe(0);
    expect(s.native.cancelled).toEqual([]);
    expect(await s.db.first('SELECT count(*) AS n FROM qc_gateway_outbox')).toEqual({ n: 1 });
  });
  it('descarta asociación ajena, versión obsoleta, instante alterado y vencimiento', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    s.setNow('2026-10-29T11:00:10Z');
    for (const payload of [
      { ...s.payload, sesion_id: randomUUID() },
      { ...s.payload, version_recordatorio: 2 },
      { ...s.payload, programado_en: '2026-10-29T11:00:01Z' },
      { ...s.payload, temperatura: 39 },
    ])
      expect(await s.coordinator.processPush(payload)).toBe('discarded');
    s.setNow('2026-10-29T11:10:00Z');
    expect(await s.coordinator.processPush(s.payload)).toBe('discarded');
    expect(s.native.presentations).toBe(0);
  });
  it('suprime todos los signos del día al SAVE incluso sin ACK y conserva medicación', async () => {
    const medication = { ...rule, id: randomUUID(), tipo: 'medicacion' as const };
    const s = await setup([rule, medication]);
    await s.coordinator.reconcile();
    s.setNow('2026-10-29T11:00:10Z');
    await s.db.transaction((tx) =>
      enqueueOperational(
        tx,
        binding,
        'completion',
        {
          operacion_id: randomUUID(),
          tipo_registro: 'signos',
          fecha_local: '2026-10-29',
          zona_horaria: 'America/Santiago',
          registrado_en: '2026-10-29T11:00:10Z',
        },
        '2026-10-29T11:00:10Z',
      ),
    );
    expect(await s.coordinator.processPush(s.payload)).toBe('discarded');
    await s.coordinator.reconcile();
    const today = [...s.native.pending.values()].filter((v) =>
      v.data.payload.ocurrencia_id.includes(':2026-10-29:'),
    );
    expect(today).toHaveLength(1);
    expect(today[0]!.data.payload.recordatorio_id).toBe(medication.id);
  });
  it('conciliar permiso revocado cancela y vuelve a programar tras recuperarlo', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    s.native.allowed = false;
    expect((await s.coordinator.reconcile()).confirmed).toBe(0);
    expect(s.native.pending.size).toBe(0);
    s.native.allowed = true;
    expect((await s.coordinator.reconcile()).confirmed).toBe(14);
  });
  it('una cancelación fallida se conserva pendiente sin volver a presentar el push', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    s.native.failCancel = true;
    s.setNow('2026-10-29T11:00:10Z');
    expect(await s.coordinator.processPush(s.payload)).toBe('presented');
    expect(await s.coordinator.processPush(s.payload)).toBe('duplicate');
    expect(s.native.presentations).toBe(1);
    expect(await s.coordinator.reconcile()).toMatchObject({
      confirmed: 13,
      wanted: 13,
      pendingCancellations: 1,
    });
    s.native.failCancel = false;
    await s.coordinator.reconcile();
    expect(
      s.native.pending.has('qc06:' + binding.sessionId + ':' + s.payload.ocurrencia_id + ':backup'),
    ).toBe(false);
  });
  it('conserva tombstones sin volver a cancelar todos los avisos históricos en cada apertura', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    const next = { ...rule, version: 2, horas: ['09:00'] };
    await s.coordinator.repository.snapshot({ ...s.snapshot(2), recordatorios: [next] });
    await s.coordinator.reconcile();
    expect(s.native.cancelled.length).toBe(14);
    s.native.cancelled = [];
    await s.coordinator.reconcile();
    expect(s.native.cancelled).toEqual([]);
    expect(s.native.pending.size).toBe(14);
  });
  it('solo observaciones reales generan respaldo_observado/abierto con UUID estable', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    expect(await s.db.first('SELECT count(*) AS n FROM qc_gateway_outbox')).toEqual({ n: 0 });
    const data = [...s.native.pending.values()][0]!.data;
    s.setNow('2026-10-29T11:02:01Z');
    expect(await s.coordinator.observe({ ...data, contexto: 'other' }, 'opened')).toBeNull();
    await s.coordinator.observe(data, 'received');
    expect(await s.coordinator.observe(data, 'opened')).toBe('/vitales/registrar');
    await s.coordinator.observe(data, 'opened');
    expect(await s.db.first('SELECT count(*) AS n FROM qc_gateway_outbox')).toEqual({ n: 2 });
  });
  it('cerrar cancela únicamente trabajos persistidos de esta asociación', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    s.native.pending.set('foreign', {
      data: {
        quimiocare_agenda: 1,
        contexto: 'other',
        instalacion_id: randomUUID(),
        canal: 'respaldo',
        payload: { ...s.payload, sesion_id: randomUUID() },
      },
      at: '2026-10-29T11:02:00Z',
    });
    await s.coordinator.close();
    expect([...s.native.pending.keys()]).toEqual(['foreign']);
  });
  it('no procesa un contexto cerrado ni atribuye éxito por un ticket remoto', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    s.close();
    await expect(s.coordinator.processPush(s.payload)).rejects.toThrow('changed');
    expect(await s.db.first('SELECT count(*) AS n FROM qc_gateway_outbox')).toEqual({ n: 0 });
  });
  it('un coordinador cerrado no reactiva avisos después de revocar la asociación', async () => {
    const s = await setup();
    await s.coordinator.reconcile();
    await s.coordinator.close();
    await expect(s.coordinator.reconcile()).rejects.toThrow('cerrado');
    expect(s.native.pending.size).toBe(0);
  });
  it('el validador estricto no acepta campos clínicos ni identificadores civiles incoherentes', async () => {
    const s = await setup();
    expect(notificationPayload(s.payload)).toBe(true);
    expect(notificationPayload({ ...s.payload, nombre: 'Nombre' })).toBe(false);
    expect(
      notificationPayload({
        ...s.payload,
        ocurrencia_id: s.payload.ocurrencia_id.replace(':1:', ':2:'),
      }),
    ).toBe(false);
  });
});
