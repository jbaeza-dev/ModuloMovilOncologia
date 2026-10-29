import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSqliteTestHarness,
  patientA,
  validVitals,
  ids,
} from '../local/testing/sqlite-test-harness';
import { migrateDatabase, migrations } from '../local/migrations';
import { enqueueOperational, operationalOutbox, utf8Length } from './operational-outbox';
import { enqueueClinicalCommand } from '../sync/clinical-command';
import { createPatientRepository } from '../local/repository';
import { clinicalCaptureHook } from '../sync/legacy-command';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const scope = {
    owner: '964d32f1-6941-579f-9f08-b60342194da9',
    localPatientId: patientA,
    environment: 'demo:ops',
  },
  id = 'ed21a163-0102-4b25-98af-4b3552cc87ad',
  save = '2026-10-29T03:01:00Z',
  measured = '2026-10-28T22:00:00Z';
const event = (uuid = id) => ({
  operacion_id: uuid,
  tipo_registro: 'signos' as const,
  fecha_local: '2026-10-29',
  zona_horaria: 'America/Santiago' as const,
  registrado_en: save,
});
async function setup() {
  const db = harness.open();
  await migrateDatabase(db);
  await db.exec(
    'CREATE TABLE qc_upload_signos(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT);CREATE TABLE qc_upload_epro(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT)',
  );
  return db;
}
describe('Metadatos operativos durables', () => {
  it('usa el instante SAVE y día Santiago sin alterar UUID ni fecha clínica original', async () => {
    const db = await setup();
    await db.transaction(async (tx) => {
      await enqueueClinicalCommand(
        tx,
        scope,
        {
          kind: 'signos',
          capturedAt: measured,
          payload: { id, fecha_registro: measured, temperatura: 36.5 },
        },
        save,
      );
    });
    const row = await db.first<{ body_json: string }>('SELECT body_json FROM qc_gateway_outbox');
    expect(JSON.parse(row!.body_json)).toEqual(event());
    expect(await db.first('SELECT captured_at FROM qc_clinical_command')).toEqual({
      captured_at: measured,
    });
    expect(await db.first('SELECT registered_at FROM qc_operational_event')).toEqual({
      registered_at: save,
    });
  });
  it('revierte historia, comando y SDK si falla la cola operativa', async () => {
    const db = await setup();
    await db.exec(
      "CREATE TRIGGER reject_ops BEFORE INSERT ON qc_gateway_outbox BEGIN SELECT RAISE(ABORT,'synthetic failure');END;",
    );
    const repo = createPatientRepository(
      db,
      patientA,
      ids(id, 'queue-id'),
      () => save,
      clinicalCaptureHook(scope),
    );
    await expect(repo.createVitals(validVitals)).rejects.toThrow('synthetic failure');
    for (const table of [
      'signos_vitales',
      'qc_clinical_command',
      'qc_upload_signos',
      'qc_operational_event',
      'qc_gateway_outbox',
    ])
      expect(await db.first('SELECT count(*) AS n FROM ' + table)).toEqual({ n: 0 });
  });
  it('repite el mismo UUID/cuerpo tras perder un ACK, sin enviar valores clínicos', async () => {
    const db = await setup();
    await db.transaction((tx) => enqueueOperational(tx, scope, 'completion', event(), save));
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({
        status: 200,
        body: { items: [{ operacion_id: id, resultado: 'replay' }] },
      });
    const queue = operationalOutbox(db, scope, request, () => undefined);
    await expect(queue.flush()).rejects.toThrow('lost');
    expect(await queue.pending()).toHaveLength(1);
    expect(await queue.flush()).toBe(1);
    expect(await queue.pending()).toEqual([]);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    expect(Object.keys(request.mock.calls[0]![1].items[0]).sort()).toEqual([
      'fecha_local',
      'operacion_id',
      'registrado_en',
      'tipo_registro',
      'zona_horaria',
    ]);
  });
  it('rechaza cambiar el cuerpo de un UUID y no confirma lotes con ACK parcial', async () => {
    const db = await setup();
    await db.transaction((tx) => enqueueOperational(tx, scope, 'completion', event(), save));
    await expect(
      db.transaction((tx) =>
        enqueueOperational(
          tx,
          scope,
          'completion',
          { ...event(), fecha_local: '2026-10-28' },
          save,
        ),
      ),
    ).rejects.toThrow('otro evento');
    const queue = operationalOutbox(
      db,
      scope,
      async () => ({ status: 200, body: { items: [] } }),
      () => undefined,
    );
    await expect(queue.flush()).rejects.toThrow('lote');
    expect(await queue.pending()).toHaveLength(1);
  });
  it('marca conflictos sin reintentar ni modificar el evento y aísla cuentas', async () => {
    const db = await setup();
    await db.transaction((tx) => enqueueOperational(tx, scope, 'completion', event(), save));
    const request = vi.fn().mockResolvedValue({ status: 409, body: {} }),
      queue = operationalOutbox(db, scope, request, () => undefined);
    await expect(queue.flush()).rejects.toThrow('conflicto');
    expect((await queue.pending())[0]!.status).toBe('conflict');
    expect(await queue.flush()).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      await operationalOutbox(
        db,
        { ...scope, environment: 'other' },
        request,
        () => undefined,
      ).pending(),
    ).toEqual([]);
  });
  it('limita cada lote a 100 y 64KiB de UTF-8', async () => {
    expect(utf8Length('aé😀')).toBe(7);
    const db = await setup();
    for (let n = 1; n <= 101; n++) {
      const uuid = '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
      await db.transaction((tx) => enqueueOperational(tx, scope, 'completion', event(uuid), save));
    }
    const request = vi.fn().mockImplementation(async (_kind, body) => {
      expect(body.items.length).toBeLessThanOrEqual(100);
      expect(utf8Length(JSON.stringify(body))).toBeLessThanOrEqual(65536);
      return {
        status: 200,
        body: {
          items: body.items.map((v: { operacion_id: string }) => ({
            operacion_id: v.operacion_id,
            resultado: 'registrado',
          })),
        },
      };
    });
    const queue = operationalOutbox(db, scope, request, () => undefined);
    expect(await queue.flush()).toBe(100);
    expect(await queue.pending()).toHaveLength(1);
    expect(await queue.flush()).toBe(1);
  });
  it('migrar v12 preserva eventos anteriores sin inventar un instante de guardado', async () => {
    const db = harness.open();
    await migrateDatabase(
      db,
      migrations.filter((v) => v.version <= 12),
    );
    await db.run(
      'INSERT INTO qc_operational_event(id,owner,record_id,kind,captured_at) VALUES(?,?,?,?,?)',
      ['clinical:' + id, scope.owner, id, 'signos', measured],
    );
    await migrateDatabase(db);
    expect(
      await db.first('SELECT captured_at,registered_at,status FROM qc_operational_event'),
    ).toEqual({ captured_at: measured, registered_at: null, status: 'pendiente' });
    expect(await db.first('SELECT count(*) AS n FROM qc_gateway_outbox')).toEqual({ n: 0 });
  });
});
