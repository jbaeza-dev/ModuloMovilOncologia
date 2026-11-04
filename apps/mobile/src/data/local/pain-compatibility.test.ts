import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase, migrations } from './migrations';
import { migratePain18 } from './migrations/018_dolor_ena_compatible';
import { legacyPain14Sql } from './testing/legacy-pain14-fixture';
import { createPatientRepository } from './repository';
import { normalizeVitalValues, validateVitalInput } from './validation';
import { clinicalCaptureHook, transferLegacyCommand } from '../sync/legacy-command';
import { coherentAck } from '../sync/ack';
import { payloadOf, type ClinicalCommand } from '../sync/clinical-command';
import {
  createSqliteTestHarness,
  seedLegacyVital,
  patientA,
  patientB,
  measured,
  ids,
  validVitals,
} from './testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const blank = { temperature: '', systolic: '', diastolic: '', pulse: '', saturation: '', pain: '' };

describe('ENA y compatibilidad entre las dos ramas de migración', () => {
  it.each(['', '-1', '11', '3.5', '3,5', 'NaN', 'Infinity', '1e1', '0xA'])(
    'rechaza ENA %s sin inferir cero',
    (pain) => {
      expect(validateVitalInput({ ...blank, temperature: '36.8', pain }).valid).toBe(false);
    },
  );
  it.each(['1000', '29.9', '45.1', '37.55', '1e2', 'Infinity', '37 °C'])(
    'rechaza la temperatura %s sin truncarla',
    (temperature) => {
      expect(validateVitalInput({ ...blank, pain: '0', temperature }).valid).toBe(false);
    },
  );
  it.each([0, 10])(
    'guarda solo ENA explícita %s y rechaza el acceso a la captura de otra cuenta',
    async (pain) => {
      const db = harness.open();
      await migrateDatabase(db);
      const repo = createPatientRepository(db, patientA, ids('capture', 'queue'), () => measured);
      await repo.createVitals({
        temperatura: null,
        presion_sistolica: null,
        presion_diastolica: null,
        pulso: null,
        saturacion_o2: null,
        dolor_ena: pain,
      });
      expect((await repo.vital('capture'))?.dolor_ena).toBe(pain);
      expect(await createPatientRepository(db, patientB, ids()).vital('capture')).toBeNull();
    },
  );
  it('el repositorio rechaza ENA ausente y temperatura imposible sin generar fila ni cola', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const repo = createPatientRepository(db, patientA, ids(), () => measured);
    await expect(repo.createVitals({ ...validVitals, dolor_ena: null })).rejects.toThrow();
    await expect(repo.createVitals({ ...validVitals, temperatura: 1000 })).rejects.toThrow();
    expect(await db.all('SELECT * FROM signos_vitales')).toEqual([]);
    expect(await db.all('SELECT * FROM cola_envio')).toEqual([]);
    expect(() => normalizeVitalValues({ ...validVitals, temperatura: 37.55 })).toThrow();
  });
  it.each([13, 14, 15, 16, 17])(
    'preserva signos y colas del main versión %s sin fabricar dolor',
    async (version) => {
      const db = harness.open();
      await migrateDatabase(
        db,
        migrations.filter((m) => m.version <= version),
      );
      await seedLegacyVital(db, patientA, 'before', 'before-q');
      const signs = await db.all('SELECT * FROM signos_vitales');
      const queue = await db.all('SELECT * FROM cola_envio');
      await migrateDatabase(db);
      expect(await db.all('SELECT * FROM signos_vitales')).toEqual(
        signs.map((row) => ({ ...(row as object), dolor_ena: null })),
      );
      expect(await db.all('SELECT * FROM cola_envio')).toEqual(queue);
      expect(await db.first('PRAGMA user_version')).toEqual({
        user_version: migrations[migrations.length - 1]!.version,
      });
      expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    },
  );
  it('reconoce el P07 antiguo v14 con ENA, conserva dolor/cola y completa la bitácora al reabrir', async () => {
    const dir = harness.createTempDir();
    const file = dir + '/legacy-pain.db';
    const db = harness.open(file);
    await migrateDatabase(
      db,
      migrations.filter((m) => m.version <= 13),
    );
    await seedLegacyVital(db, patientA, 'old', 'old-q');
    await db.exec(legacyPain14Sql);
    await db.run('UPDATE signos_vitales SET dolor_ena=0 WHERE id=?', ['old']);
    await db.exec('PRAGMA user_version=14');
    const before = await db.all('SELECT * FROM signos_vitales');
    const queue = await db.all('SELECT * FROM cola_envio');
    await migrateDatabase(db);
    expect(await db.all('SELECT * FROM signos_vitales')).toEqual(before);
    expect(await db.all('SELECT * FROM cola_envio')).toEqual(queue);
    expect(
      await db.first("SELECT name FROM sqlite_master WHERE name='qc_medication_intake_events'"),
    ).not.toBeNull();
    expect(
      (await db.all<{ name: string }>('PRAGMA table_info(qc_medication_intake_log)')).map(
        (row) => row.name,
      ),
    ).toContain('es_programado');
    harness.closeLastOpened();
    const reopened = harness.open(file);
    await migrateDatabase(reopened);
    expect(await reopened.all('SELECT * FROM signos_vitales')).toEqual(before);
    expect(await reopened.all('SELECT * FROM cola_envio')).toEqual(queue);
  });
  it('revierte una interrupción del cambio de tabla sin perder versión, datos ni cola', async () => {
    const db = harness.open();
    await migrateDatabase(
      db,
      migrations.filter((m) => m.version <= 17),
    );
    await seedLegacyVital(db, patientA, 'old', 'q');
    const before = await db.all('SELECT * FROM signos_vitales');
    await expect(
      migrateDatabase(db, [
        {
          version: 18,
          run: async (tx) => {
            await migratePain18(tx);
            throw new Error('interrupción sintética');
          },
        },
      ]),
    ).rejects.toThrow('interrupción');
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: 17 });
    expect(await db.all('SELECT * FROM signos_vitales')).toEqual(before);
    await migrateDatabase(db);
    expect(await db.first('PRAGMA user_version')).toEqual({
      user_version: migrations[migrations.length - 1]!.version,
    });
  });
  it('conserva un esquema desconocido y detiene la migración en lugar de eliminar columnas', async () => {
    const db = harness.open();
    await migrateDatabase(
      db,
      migrations.filter((m) => m.version <= 17),
    );
    await db.exec('ALTER TABLE signos_vitales ADD COLUMN otra_extension TEXT');
    await expect(migrateDatabase(db)).rejects.toThrow('no reconocido');
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: 17 });
  });
  it('mantiene ENA en el comando SDK y exige un ACK que la conserve exactamente', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    await db.exec(
      'CREATE TABLE qc_upload_signos(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT)',
    );
    const owner = '964d32f1-6941-579f-9f08-b60342194da9';
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const repo = createPatientRepository(
      db,
      patientA,
      ids(id, 'queue'),
      () => measured,
      clinicalCaptureHook({ owner, localPatientId: patientA, environment: 'synthetic-test' }),
    );
    await repo.createVitals({ ...validVitals, dolor_ena: 0 });
    const command = (await db.first<ClinicalCommand>('SELECT * FROM qc_clinical_command'))!;
    const body = JSON.parse(command.payload_json);
    expect(body).toMatchObject({ version_dolor: 1, dolor_ena: 0, id, fecha_registro: measured });
    const ack = { ...body, sincronizado: true, fecha_subida: measured };
    expect(coherentAck(command, 201, ack)).toBe(true);
    expect(coherentAck(command, 201, { ...ack, dolor_ena: undefined })).toBe(false);
    expect(coherentAck(command, 201, { ...ack, dolor_ena: 1 })).toBe(false);
  });
});

describe('validación al emitir y preservación de colas históricas', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  it.each([
    { temperatura: 1000 },
    { temperatura: 37.55 },
    { pulso: 1 },
    { saturacion_oxigeno: 101 },
    { presion_arterial_sistolica: 70, presion_arterial_diastolica: 80 },
  ])('impide emitir una captura nueva inválida %j', (values) => {
    expect(() =>
      payloadOf({
        id,
        kind: 'signos',
        captured_at: measured,
        payload_json: JSON.stringify({
          id,
          fecha_registro: measured,
          version_dolor: 1,
          dolor_ena: 0,
          ...values,
        }),
      }),
    ).toThrow();
  });
  it('conserva el snapshot histórico inválido sin fabricar una nueva operación de subida', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    await seedLegacyVital(db, patientA, id, 'legacy-invalid');
    const row = (await db.first<{ payload_json: string }>(
      'SELECT payload_json FROM cola_envio WHERE id=?',
      ['legacy-invalid'],
    ))!;
    const value = JSON.parse(row.payload_json);
    value.record.temperatura = 1000;
    const snapshot = JSON.stringify(value);
    await db.run('UPDATE signos_vitales SET temperatura=? WHERE id=?', [1000, id]);
    await db.run('UPDATE cola_envio SET payload_json=? WHERE id=?', [snapshot, 'legacy-invalid']);
    const scope = {
      owner: '964d32f1-6941-579f-9f08-b60342194da9',
      localPatientId: patientA,
      environment: 'test',
    };
    expect(await transferLegacyCommand(db, scope, 'legacy-invalid')).toBe('preserved');
    expect(await db.all('SELECT * FROM qc_clinical_command')).toEqual([]);
    expect(
      (
        await db.first<{ payload_json: string }>('SELECT payload_json FROM cola_envio WHERE id=?', [
          'legacy-invalid',
        ])
      )?.payload_json,
    ).toBe(snapshot);
    expect(await db.first('SELECT temperatura FROM signos_vitales WHERE id=?', [id])).toEqual({
      temperatura: 1000,
    });
    await expect(transferLegacyCommand(db, scope, 'legacy-invalid', true)).rejects.toThrow(
      'mediciones inválidas',
    );
  });
});

describe('metadatos de lectores nativos después de migrar', () => {
  it('refresca todos los lectores solo después de confirmar la versión y conserva los registros', async () => {
    const db = harness.open();
    await migrateDatabase(
      db,
      migrations.filter((m) => m.version <= 17),
    );
    let calls = 0;
    db.refreshSchema = async () => {
      expect((await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(
        migrations[migrations.length - 1]!.version,
      );
      calls++;
    };
    await migrateDatabase(db);
    expect(calls).toBe(1);
  });
});
