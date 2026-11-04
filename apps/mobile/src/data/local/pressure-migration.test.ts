import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase, migrations } from './migrations';
import { PRESION_INDEPENDIENTE_SQL } from './migrations/012_presion_independiente';
import { createPatientRepository } from './repository';
import {
  createSqliteTestHarness,
  ids,
  measured,
  patientA,
  patientB,
  seedLegacyVital,
} from './testing/sqlite-test-harness';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
describe('v12 independent pressure readings', () => {
  it('preserves A/B history and immutable queued payloads while allowing either pressure field alone', async () => {
    const db = harness.open();
    await migrateDatabase(
      db,
      migrations.filter((m) => m.version <= 11),
    );
    await seedLegacyVital(db, patientA, 'a-old', 'a-q');
    await seedLegacyVital(db, patientB, 'b-old', 'b-q');
    await db.run(
      "UPDATE signos_vitales SET id_ficha_clinica='retained-file',tratamiento_id='retained-treatment',fecha_subida=? WHERE id='a-old'",
      [measured],
    );
    const before = await db.all('SELECT * FROM signos_vitales ORDER BY id');
    const queue = await db.all('SELECT * FROM cola_envio ORDER BY id');
    await migrateDatabase(db);
    await migrateDatabase(db);
    expect(await db.all('SELECT * FROM signos_vitales ORDER BY id')).toEqual(
      before.map((row) => ({ ...(row as object), dolor_ena: null })),
    );
    expect(await db.all('SELECT * FROM cola_envio ORDER BY id')).toEqual(queue);
    const partial = {
      temperatura: null,
      dolor_ena: 0,
      presion_sistolica: null,
      presion_diastolica: null,
      pulso: null,
      saturacion_o2: null,
    };
    const repo = createPatientRepository(
      db,
      patientA,
      ids('sys-only', 'sys-q', 'dia-only', 'dia-q'),
      () => measured,
    );
    await repo.createVitals({ ...partial, presion_sistolica: 120 });
    await repo.createVitals({ ...partial, presion_diastolica: 80 });
    expect(await repo.vital('sys-only')).toMatchObject({
      presion_sistolica: 120,
      presion_diastolica: null,
    });
    expect(await repo.vital('dia-only')).toMatchObject({
      presion_sistolica: null,
      presion_diastolica: 80,
    });
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.first('PRAGMA user_version')).toEqual({
      user_version: migrations[migrations.length - 1]!.version,
    });
  });
  it('rolls back the table rebuild and version if the migration is interrupted by a SQL failure', async () => {
    const db = harness.open();
    await migrateDatabase(
      db,
      migrations.filter((m) => m.version <= 11),
    );
    await seedLegacyVital(db, patientA, 'kept', 'kept-q');
    const before = await db.all('SELECT * FROM signos_vitales');
    const queue = await db.all('SELECT * FROM cola_envio');
    const schema = await db.first("SELECT sql FROM sqlite_master WHERE name='signos_vitales'");
    await expect(
      migrateDatabase(db, [
        {
          version: 12,
          sql: PRESION_INDEPENDIENTE_SQL + '\nINSERT INTO missing_failure_probe VALUES(1);',
        },
      ]),
    ).rejects.toThrow();
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: 11 });
    expect(await db.all('SELECT * FROM signos_vitales')).toEqual(before);
    expect(await db.all('SELECT * FROM cola_envio')).toEqual(queue);
    expect(await db.first("SELECT sql FROM sqlite_master WHERE name='signos_vitales'")).toEqual(
      schema,
    );
    expect(
      await db.first("SELECT name FROM sqlite_master WHERE name='signos_vitales_v12'"),
    ).toBeNull();
  });
});
