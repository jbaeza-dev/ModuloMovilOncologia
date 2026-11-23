import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrudEntry } from '@powersync/common';
import {
  createSqliteTestHarness,
  patientA,
  ids,
  measured,
  validVitals,
} from '../local/testing/sqlite-test-harness';
import { migrateDatabase } from '../local/migrations';
import { createPatientRepository } from '../local/repository';
import type { SqlConnection } from '../local/core/sql';
import { clinicalCaptureHook } from './legacy-command';
import type { ClinicalCommand, ClinicalScope } from './clinical-command';
import { ClinicalConnector } from './clinical-connector';
import {
  KEPT_ON_PHONE,
  isKeptOnPhone,
  isSetAside,
  keepSetAsideOnPhone,
  listSetAside,
  retryAllSetAside,
  retrySetAside,
} from './paused-command';
import { getSyncStatusLabel } from '../../features/vitals/vitals-formatters';

const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const owner = '964d32f1-6941-579f-9f08-b60342194da9';
const otherOwner = '2dcb04f2-a2ad-5ea4-b711-9acd7e570002';
const scope: ClinicalScope = { owner, localPatientId: patientA, environment: 'demo:test' };
const first = 'ed21a163-0102-4b25-98af-4b3552cc87ad';
const second = 'ed21a163-0102-4b25-98af-4b3552cc87ae';

/** Las tablas de subida imitan a PowerSync insertOnly: cada INSERT es una operación nueva. */
async function database() {
  const db = harness.open();
  await migrateDatabase(db);
  await db.exec(`CREATE TABLE qc_upload_signos(id TEXT,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT);
    CREATE TABLE qc_upload_epro(id TEXT,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT);
    CREATE TABLE pregunta(id TEXT,formulario_id TEXT,codigo TEXT);`);
  await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
    patientA,
    'A',
    measured,
  ]);
  return db;
}
function repository(db: SqlConnection, id: string) {
  return createPatientRepository(
    db,
    patientA,
    ids(id, 'queue:' + id),
    () => measured,
    clinicalCaptureHook(scope),
  );
}
async function command(db: SqlConnection, id = first) {
  return (await db.first<ClinicalCommand>('SELECT * FROM qc_clinical_command WHERE id=?', [id]))!;
}
async function setAside(db: SqlConnection, id = first, code = 'FORMULARIO_NO_ENCONTRADO') {
  await db.run("UPDATE qc_clinical_command SET status='pausado',error_json=? WHERE id=?", [
    JSON.stringify({ code, details: null }),
    id,
  ]);
}
async function uploads(db: SqlConnection, id = first) {
  return (await db.first<{ n: number }>('SELECT count(*) n FROM qc_upload_signos WHERE id=?', [
    id,
  ]))!.n;
}

describe('registros apartados por un error técnico', () => {
  it('lista solo los apartados del dueño y entorno activos, sin datos clínicos', async () => {
    const db = await database();
    await repository(db, first).createVitals(validVitals);
    await repository(db, second).createVitals(validVitals);
    await setAside(db, first);
    await setAside(db, second, 'SESION_EXPIRED');
    const records = await listSetAside(db, scope);
    expect(records).toEqual([
      { id: first, kind: 'signos', capturedAt: measured, code: 'FORMULARIO_NO_ENCONTRADO' },
    ]);
    expect(await listSetAside(db, { ...scope, owner: otherOwner })).toEqual([]);
    expect(await listSetAside(db, { ...scope, environment: 'otro' })).toEqual([]);
  });

  it('distingue una pausa de sesión de un registro apartado', () => {
    expect(isSetAside({ status: 'pausado', error_json: '{"code":"SESION_DENIED"}' })).toBe(false);
    expect(isSetAside({ status: 'pausado', error_json: '{"code":"ERROR_NO_CLASIFICADO"}' })).toBe(
      true,
    );
    expect(isSetAside({ status: 'pausado', error_json: 'dañado' })).toBe(true);
    expect(isSetAside({ status: 'pendiente', error_json: null })).toBe(false);
  });

  it('reintentar devuelve el registro a la cola con el mismo UUID, fecha y contenido', async () => {
    const db = await database();
    await repository(db, first).createVitals(validVitals);
    const original = await command(db);
    await setAside(db);
    await retrySetAside(db, scope, first, measured);
    expect(await command(db)).toMatchObject({
      status: 'pendiente',
      error_json: null,
      payload_json: original.payload_json,
      captured_at: original.captured_at,
    });
    expect(await uploads(db)).toBe(2);
    expect(await listSetAside(db, scope)).toEqual([]);
  });

  it('el reintento lo envía el conector y queda aceptado', async () => {
    const db = await database();
    await repository(db, first).createVitals(validVitals);
    await setAside(db);
    await retrySetAside(db, scope, first, measured);
    const c = await command(db);
    const abort = new AbortController();
    const request = vi.fn(async (_s: string, _p: string, _m: string, body: unknown) => ({
      status: 201,
      body: { ...(body as object), sincronizado: true, fecha_subida: measured },
    }));
    const connector = new ClinicalConnector(
      scope,
      'http://127.0.0.1:8080',
      {
        getCurrentUser: () => ({ id: owner }),
        getContextSignal: () => abort.signal,
        credentialsForSync: async () => ({
          token: 'synthetic-only',
          owner,
          expiresAt: new Date(Date.now() + 60000),
          signal: abort.signal,
        }),
        request,
      } as unknown as ConstructorParameters<typeof ClinicalConnector>[2],
      db,
      vi.fn(),
      () => measured,
    );
    const operation = {
      id: c.id,
      table: 'qc_upload_signos',
      op: 'PUT',
      opData: {
        owner: c.owner,
        environment: c.environment,
        captured_at: c.captured_at,
        payload_json: c.payload_json,
        legacy_queue_id: c.legacy_queue_id,
      },
    } as unknown as CrudEntry;
    const complete = vi.fn(async () => {});
    await connector.uploadTransaction({ crud: [operation], complete });
    expect(request).toHaveBeenCalledTimes(1);
    expect((await command(db)).status).toBe('aceptado');
  });

  it('conservar en el teléfono lo deja visible en el historial como no enviado', async () => {
    const db = await database();
    const repo = repository(db, first);
    await repo.createVitals(validVitals);
    await setAside(db);
    await keepSetAsideOnPhone(db, scope, first, measured);
    const kept = await command(db);
    expect(isKeptOnPhone(kept)).toBe(true);
    expect(JSON.parse(kept.error_json!)).toEqual({
      code: KEPT_ON_PHONE,
      previo: 'FORMULARIO_NO_ENCONTRADO',
    });
    const row = await repo.vital(first);
    expect(row?.estado_envio).toBe('conservado_local');
    expect(getSyncStatusLabel(row!)).toBe('No enviado · Conservado solo en este teléfono');
    expect(await db.first('SELECT id FROM signos_vitales WHERE id=?', [first])).toEqual({
      id: first,
    });
    expect(await listSetAside(db, scope)).toEqual([]);
  });

  it('no actúa sobre un registro que no está apartado ni sobre el de otro dueño', async () => {
    const db = await database();
    await repository(db, first).createVitals(validVitals);
    await expect(retrySetAside(db, scope, first)).rejects.toThrow(/ya no está apartado/);
    await setAside(db, first, 'SESION_EXPIRED');
    await expect(keepSetAsideOnPhone(db, scope, first)).rejects.toThrow(/ya no está apartado/);
    await setAside(db);
    await expect(retrySetAside(db, { ...scope, owner: otherOwner }, first)).rejects.toThrow();
    expect((await command(db)).status).toBe('pausado');
    expect(await uploads(db)).toBe(1);
  });

  it('reintentar todos solo mueve los apartados y deja las pausas de sesión', async () => {
    const db = await database();
    await repository(db, first).createVitals(validVitals);
    await repository(db, second).createVitals(validVitals);
    await setAside(db, first);
    await setAside(db, second, 'SESION_DENIED');
    expect(await retryAllSetAside(db, scope, measured)).toBe(1);
    expect((await command(db, first)).status).toBe('pendiente');
    expect((await command(db, second)).status).toBe('pausado');
  });
});
