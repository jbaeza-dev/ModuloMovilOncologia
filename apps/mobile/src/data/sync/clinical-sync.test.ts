import { getSyncStatusLabel } from '../../features/vitals/vitals-formatters';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrudEntry } from '@powersync/common';
import {
  createSqliteTestHarness,
  patientA,
  patientB,
  ids,
  measured,
  validVitals,
} from '../local/testing/sqlite-test-harness';
import { migrateDatabase, migrations } from '../local/migrations';
import { createPatientRepository } from '../local/repository';
import { clinicalCaptureHook } from './legacy-command';
import {
  enqueueClinicalCommand,
  type ClinicalCommand,
  type ClinicalScope,
} from './clinical-command';
import { ClinicalConnector, ClinicalUploadPaused } from './clinical-connector';
import { coherentAck, classifyClinicalError } from './ack';
import { migrateOwner, migrationPhases } from './migration';
import { sqlStatements } from './sql-connection';
import type { SqlConnection } from '../local/core/sql';
import { saveContractEpro } from './clinical-repository';
import type { DefinitionSnapshot } from './catalog';

const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const owner = '964d32f1-6941-579f-9f08-b60342194da9';
const scope: ClinicalScope = { owner, localPatientId: patientA, environment: 'demo:test' };
const capture = 'ed21a163-0102-4b25-98af-4b3552cc87ad';
const second = 'ed21a163-0102-4b25-98af-4b3552cc87ae';
async function database() {
  const db = harness.open();
  await migrateDatabase(db);
  await db.exec(`CREATE TABLE qc_upload_signos(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT);
    CREATE TABLE qc_upload_epro(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT);
    CREATE TABLE pregunta(id TEXT,formulario_id TEXT,codigo TEXT);`);
  await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
    patientA,
    'A',
    measured,
  ]);
  await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
    patientB,
    'B',
    measured,
  ]);
  return db;
}
async function save(db: SqlConnection, id = capture) {
  return createPatientRepository(
    db,
    patientA,
    ids(id, 'queue:' + id),
    () => measured,
    clinicalCaptureHook(scope),
  ).createVitals(validVitals);
}
async function command(db: SqlConnection, id = capture) {
  return (await db.first<ClinicalCommand>('SELECT * FROM qc_clinical_command WHERE id=?', [id]))!;
}
function operation(c: ClinicalCommand): CrudEntry {
  return {
    id: c.id,
    table: c.kind === 'signos' ? 'qc_upload_signos' : 'qc_upload_epro',
    op: 'PUT',
    opData: {
      owner: c.owner,
      environment: c.environment,
      captured_at: c.captured_at,
      payload_json: c.payload_json,
      legacy_queue_id: c.legacy_queue_id,
    },
  } as unknown as CrudEntry;
}
function context(
  db: SqlConnection,
  respond: (
    path: string,
    body: Record<string, unknown>,
  ) => Promise<{ status: number; body: unknown }>,
) {
  const abort = new AbortController();
  const request = vi.fn(async (_service: string, path: string, _method: string, body: unknown) =>
    respond(path, body as Record<string, unknown>),
  );
  const session = {
    getCurrentUser: () => ({ id: owner }),
    getContextSignal: () => abort.signal,
    credentialsForSync: async () => ({
      token: 'synthetic-only',
      owner,
      expiresAt: new Date(Date.now() + 60000),
      signal: abort.signal,
    }),
    request,
  };
  const pause = vi.fn();
  const connector = new ClinicalConnector(
    scope,
    'http://127.0.0.1:8080',
    session as unknown as ConstructorParameters<typeof ClinicalConnector>[2],
    db,
    pause,
    () => measured,
  );
  return { connector, request, abort, pause };
}
const ack = (body: Record<string, unknown>) => ({
  status: 201,
  body: { ...body, sincronizado: true, fecha_subida: measured },
});

describe('P04 C10 immutable transport and owner states', () => {
  const formId = 'cd3d5bc3-7d2a-5adf-b5fb-f090a98cec5b';
  const question = 'e6a46d67-4f95-5e58-ae48-f4fc280c4e49';
  const definition: DefinitionSnapshot = {
    form: {
      id: formId,
      version: 1,
      titulo: 'Technical fixture',
      configuracion: { version_condiciones: 1 },
    },
    questions: [{ id: question, codigo: 'MADRE_DEMO' }],
  };
  for (const value of [false, 0])
    it('preserves typed ' + String(value) + ' through C10, including lost ACK retry', async () => {
      const db = await database();
      await saveContractEpro(db, scope, definition, {
        id: capture,
        fecha_respuesta: measured,
        respuestas: [{ pregunta_id: question, valor: value }],
      });
      const original = await command(db),
        complete = vi.fn(async () => {});
      let calls = 0;
      const client = context(db, async (path, body) => {
        expect(path).toBe('/api/v1/formularios/' + formId + '/respuestas');
        expect(body).toEqual({
          id: capture,
          fecha_respuesta: measured,
          respuestas: [{ pregunta_id: question, valor: value }],
        });
        if (++calls === 1) throw new Error('Connection lost after server commit');
        return {
          status: 201,
          body: {
            id: capture,
            paciente_id: owner,
            formulario_id: formId,
            formulario_version: 1,
            fecha_respuesta_cliente: measured,
            fecha_recepcion_servidor: measured,
            respuestas: [{ pregunta_id: question, codigo_pregunta: 'MADRE_DEMO', valor: value }],
          },
        };
      });
      const transaction = { crud: [operation(original)], complete };
      await expect(client.connector.uploadTransaction(transaction)).rejects.toThrow(
        'Connection lost',
      );
      expect(complete).not.toHaveBeenCalled();
      await client.connector.uploadTransaction(transaction);
      expect((await command(db)).status).toBe('aceptado');
      expect((await command(db)).payload_json).toBe(original.payload_json);
      expect(complete).toHaveBeenCalledTimes(1);
      await client.connector.uploadTransaction(transaction);
      expect(calls).toBe(2);
    });
  it('projects SDK pending ownership consistently in detail, latest and history while preserving the legacy label', async () => {
    const db = await database();
    const repo = createPatientRepository(
      db,
      patientA,
      ids(capture, 'pending-label-queue'),
      () => measured,
      clinicalCaptureHook(scope),
    );
    await repo.createVitals(validVitals);
    for (const row of [
      await repo.vital(capture),
      await repo.latestVital(),
      ...(await repo.vitals('2026-01-01')),
    ]) {
      expect(row?.gestor_envio).toBe('powersync');
      expect(row?.estado_envio).toBe('pendiente');
      expect(getSyncStatusLabel(row!)).toBe('Guardado · Pendiente de envío');
    }
    const legacy = createPatientRepository(db, patientA, ids());
    const row = await legacy.vital(capture);
    expect(row?.gestor_envio).toBeUndefined();
    expect(getSyncStatusLabel(row!)).toBe('Guardado en este dispositivo');
  });
  it('counts paused SDK captures without advertising old free text as uploadable', async () => {
    const db = await database(),
      repo = createPatientRepository(
        db,
        patientA,
        ids(capture, 'q1', second, 'q2'),
        () => measured,
        clinicalCaptureHook(scope),
      );
    await repo.createVitals(validVitals);
    await repo.createSymptom('Synthetic old free-text history');
    expect(await repo.pendingCount()).toBe(1);
    await db.run("UPDATE qc_clinical_command SET status='pausado' WHERE id=?", [capture]);
    expect((await repo.vital(capture))?.estado_envio).toBe('pausado');
    expect((await repo.vitals('2026-01-01'))[0].estado_envio).toBe('pausado');
    expect((await repo.latestVital())?.estado_envio).toBe('pausado');
    expect((await repo.symptoms())[0].estado_envio).toBe('guardado_local');
    expect(await repo.pendingCount()).toBe(1);
  });
});

describe('P04 durable clinical writes (SQLite; native SDK acceptance is separate)', () => {
  it('saves history, immutable SDK command and event in one transaction', async () => {
    const db = await database();
    await save(db);
    expect((await command(db)).payload_json).toContain('presion_arterial_sistolica');
    expect(await db.first('SELECT id FROM qc_upload_signos')).toEqual({ id: capture });
    expect(await db.first('SELECT record_id FROM qc_operational_event')).toEqual({
      record_id: capture,
    });
    await expect(
      db.run("UPDATE qc_clinical_command SET payload_json='{}' WHERE id=?", [capture]),
    ).rejects.toThrow(/inmutable/);
  });
  it('rolls back capture and queue together if operational persistence fails', async () => {
    const db = await database();
    await db.exec('DROP TABLE qc_operational_event');
    await expect(save(db)).rejects.toThrow();
    expect(await db.first('SELECT id FROM signos_vitales')).toBeNull();
    expect(await db.first('SELECT id FROM qc_clinical_command')).toBeNull();
    expect(await db.first('SELECT id FROM qc_upload_signos')).toBeNull();
  });
  it('does not reinterpret legacy free text as ePRO', async () => {
    const db = await database();
    await createPatientRepository(
      db,
      patientA,
      ids(capture, 'legacy-queue'),
      () => measured,
    ).createSymptom('Dato sintético histórico');
    const target = await database();
    await migrateOwner(db, target, scope);
    expect(await target.first('SELECT id FROM sintomas')).toEqual({ id: capture });
    expect(await target.first('SELECT id FROM qc_upload_epro')).toBeNull();
  });
  it('reuses the durable ACK after interruption before SDK completion', async () => {
    const db = await database();
    await save(db);
    const c = await command(db);
    const x = context(db, async (_path, body) => ack(body));
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error('interrupted'))
      .mockResolvedValueOnce(undefined);
    await expect(x.connector.uploadTransaction({ crud: [operation(c)], complete })).rejects.toThrow(
      'interrupted',
    );
    expect((await command(db)).status).toBe('aceptado');
    await x.connector.uploadTransaction({ crud: [operation(c)], complete });
    expect(x.request).toHaveBeenCalledTimes(1);
  });
  it('does not complete a partial two-command transaction', async () => {
    const db = await database();
    await save(db);
    await save(db, second);
    let available = false;
    const x = context(db, async (_path, body) =>
      body.id === second && !available ? { status: 503, body: null } : ack(body),
    );
    const crud = [operation(await command(db)), operation(await command(db, second))],
      complete = vi.fn();
    await expect(x.connector.uploadTransaction({ crud, complete })).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
    expect((await command(db)).status).toBe('aceptado');
    expect((await command(db, second)).status).toBe('pendiente');
    available = true;
    await x.connector.uploadTransaction({ crud, complete });
    expect(x.request).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('preserves an incoherent ACK and leaves the SDK transaction pending', async () => {
    const db = await database();
    await save(db);
    const x = context(db, async (_p, body) => ack({ ...body, id: second }));
    const complete = vi.fn();
    await expect(
      x.connector.uploadTransaction({ crud: [operation(await command(db))], complete }),
    ).rejects.toBeInstanceOf(ClinicalUploadPaused);
    expect(complete).not.toHaveBeenCalled();
    expect((await command(db)).status).toBe('pausado');
  });
  it('retains rejected snapshot and history before completing a definitive 422', async () => {
    const db = await database();
    await save(db);
    const x = context(db, async () => ({
      status: 422,
      body: {
        error: {
          codigo: 'ERROR_VALIDACION',
          mensaje: 'Sintético',
          detalles: null,
          status_code: 422,
        },
      },
    }));
    const complete = vi.fn();
    await x.connector.uploadTransaction({ crud: [operation(await command(db))], complete });
    expect((await command(db)).status).toBe('rechazado');
    expect((await command(db)).error_json).toContain(capture);
    expect(await db.first('SELECT id FROM signos_vitales')).toEqual({ id: capture });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('discards an ACK arriving after context cancellation', async () => {
    const db = await database();
    await save(db);
    let release!: (v: { status: number; body: unknown }) => void;
    const response = new Promise<{ status: number; body: unknown }>((r) => {
      release = r;
    });
    const x = context(db, async () => response),
      complete = vi.fn();
    const pending = x.connector.uploadTransaction({
      crud: [operation(await command(db))],
      complete,
    });
    await vi.waitFor(() => expect(x.request).toHaveBeenCalled());
    x.abort.abort();
    release(ack(JSON.parse((await command(db)).payload_json)));
    await expect(pending).rejects.toThrow();
    expect((await command(db)).status).toBe('pendiente');
    expect(complete).not.toHaveBeenCalled();
  });
  it.each(migrationPhases)(
    'recovers from interruption after phase %s and excludes B data',
    async (phase) => {
      const source = await database();
      await save(source);
      await createPatientRepository(
        source,
        patientB,
        ids(second, 'queue-b'),
        () => measured,
      ).createVitals(validVitals);
      const target = harness.open();
      await migrateDatabase(target);
      await target.exec(
        'CREATE TABLE qc_upload_signos(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT);CREATE TABLE qc_upload_epro(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT);CREATE TABLE pregunta(id TEXT,formulario_id TEXT,codigo TEXT);',
      );
      await expect(
        migrateOwner(source, target, scope, async (p) => {
          if (p === phase) throw new Error('power loss');
        }),
      ).rejects.toThrow('power loss');
      await migrateOwner(source, target, scope);
      expect(
        await target.first('SELECT id FROM signos_vitales WHERE paciente_id=?', [patientA]),
      ).toEqual({ id: capture });
      expect(
        await target.first('SELECT id FROM signos_vitales WHERE paciente_id=?', [patientB]),
      ).toBeNull();
      expect(await target.first<{ n: number }>('SELECT count(*) n FROM qc_upload_signos')).toEqual({
        n: 1,
      });
    },
  );
  it('refuses a downgrade after the migration fence', async () => {
    const db = await database();
    await expect(
      migrateDatabase(
        db,
        migrations.filter((m) => m.version <= 10),
      ),
    ).rejects.toThrow(/más reciente/);
  });
  it('splits actual trigger migrations and quoted semicolons safely', () => {
    const statements = sqlStatements(
      "CREATE TABLE x(a TEXT); CREATE TRIGGER z BEFORE UPDATE ON x BEGIN SELECT RAISE(ABORT,'semi;colon'); END; INSERT INTO x VALUES('a'';b');",
    );
    expect(statements).toHaveLength(3);
    expect(statements[1]).toContain("'semi;colon'");
  });
  it('distinguishes blocked definitions from definitive response errors', () => {
    const error = (codigo: string, motivo?: string) => ({
      error: { codigo, status_code: 422, detalles: motivo ? { motivo } : null },
    });
    expect(
      classifyClinicalError(
        422,
        error('REGLA_DE_NEGOCIO_INVALIDA', 'DEFINICION_CONDICIONAL_INVALIDA'),
      ).decision,
    ).toBe('pause');
    expect(classifyClinicalError(422, error('PREGUNTA_NO_APLICABLE')).decision).toBe('reject');
    expect(
      classifyClinicalError(404, {
        error: { codigo: 'FORMULARIO_NO_ENCONTRADO', status_code: 404 },
      }).decision,
    ).toBe('pause');
  });
  it('rejects altered sign values in a structurally valid HTTP 201', async () => {
    const db = await database();
    await save(db);
    const c = await command(db),
      response = ack(JSON.parse(c.payload_json));
    expect(coherentAck(c, 201, response.body)).toBe(true);
    expect(coherentAck(c, 201, { ...response.body, pulso: 90 })).toBe(false);
  });
  it('does not replace a UUID to resolve a snapshot conflict', async () => {
    const db = await database();
    await save(db);
    const c = await command(db),
      body = JSON.parse(c.payload_json);
    await expect(
      db.transaction(async (tx) => {
        await enqueueClinicalCommand(tx, scope, {
          kind: 'signos',
          capturedAt: measured,
          payload: { ...body, pulso: 90 },
        });
      }),
    ).rejects.toThrow(/UUID/);
  });
});
