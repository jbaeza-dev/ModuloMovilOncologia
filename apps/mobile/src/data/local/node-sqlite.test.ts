import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { REGISTROS_SQL } from './migrations/001_registros';
import { createPatientRepository, sinceDays } from './repository';
import type { SqlConnection, SqlValue } from './sql';
import { InputError, parseSymptomDescription, parseVitalInput } from './validation';

const patientA = '11111111-1111-4111-8111-111111111111';
const patientB = '22222222-2222-4222-8222-222222222222';
const measured = '2026-09-28T12:30:00.000Z';
const validVitals = {
  temperatura: 36.8,
  presion_sistolica: 120,
  presion_diastolica: 80,
  pulso: 72,
  saturacion_o2: 98,
};
const opened: DatabaseSync[] = [];
const temporary: string[] = [];

function nodeConnection(database: DatabaseSync): SqlConnection {
  const operations = {
    exec: async (sql: string) => {
      database.exec(sql);
    },
    run: async (sql: string, values: SqlValue[] = []) => {
      database.prepare(sql).run(...values);
    },
    first: async <T>(sql: string, values: SqlValue[] = []) =>
      (database.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T>(sql: string, values: SqlValue[] = []) =>
      database.prepare(sql).all(...values) as T[],
  };
  return {
    ...operations,
    async transaction(work) {
      database.exec('BEGIN IMMEDIATE');
      try {
        await work({
          ...operations,
          transaction: async () => {
            throw new Error('Transacción anidada');
          },
        });
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function open(file = ':memory:') {
  const native = new DatabaseSync(file);
  opened.push(native);
  return nodeConnection(native);
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? `extra-${index}`;
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('migraciones SQLite', () => {
  it('crea la versión 1 y conserva filas tras reabrir y repetir la migración', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'quimiocare-sqlite-'));
    temporary.push(directory);
    const file = join(directory, 'local.db');
    const first = open(file);
    await migrateDatabase(first);
    const repository = createPatientRepository(first, patientA, ids('v1', 'q1'), () => measured);
    await repository.createVitals(validVitals);
    opened.pop()?.close();

    const second = open(file);
    await migrateDatabase(second);
    expect(
      (await second.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(1);
    expect(
      (await createPatientRepository(second, patientA, ids()).vitals('2026-01-01', 30, 0)).map(
        (row) => row.id,
      ),
    ).toEqual(['v1']);
  });

  it('revierte una migración fallida sin perder la versión anterior', async () => {
    const database = open();
    await migrateDatabase(database);
    await createPatientRepository(database, patientA, ids('v1', 'q1'), () => measured).createVitals(
      validVitals,
    );
    await expect(
      migrateDatabase(database, [
        { version: 1, sql: REGISTROS_SQL },
        { version: 2, sql: 'CREATE TABLE temporal (id TEXT); INSERT INTO inexistente VALUES (1);' },
      ]),
    ).rejects.toThrow();
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(1);
    expect(
      await database.first("SELECT name FROM sqlite_master WHERE name = 'temporal'"),
    ).toBeNull();
    expect((await createPatientRepository(database, patientA, ids()).latestVital())?.id).toBe('v1');
  });

  it('rechaza una versión de base posterior sin modificarla', async () => {
    const database = open();
    await database.exec('PRAGMA user_version = 9');
    await expect(migrateDatabase(database)).rejects.toThrow('versión más reciente');
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(9);
  });
});

describe('registros y cola local', () => {
  it('guarda registro e instantánea pendiente para signos y síntomas', async () => {
    const database = open();
    await migrateDatabase(database);
    const repository = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 's1', 'q2'),
      () => measured,
    );
    await repository.createVitals(validVitals);
    await repository.createSymptom('Molestia de prueba');
    const rows = await database.all<{
      tipo_entidad: string;
      registro_id: string;
      payload_json: string;
      estado: string;
    }>(
      'SELECT tipo_entidad, registro_id, payload_json, estado FROM cola_envio ORDER BY creado_en, id',
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.estado)).toEqual(['pendiente', 'pendiente']);
    expect(JSON.parse(rows[0].payload_json)).toMatchObject({
      schemaVersion: 1,
      entity: 'signos_vitales',
      record: { id: 'v1', paciente_id: patientA },
    });
    expect((await repository.latestVital())?.fecha_subida).toBeNull();
    expect(await repository.pendingCount()).toBe(2);
  });

  it('revierte el registro cuando la operación de cola falla', async () => {
    const database = open();
    await migrateDatabase(database);
    const repository = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 'v2', 'q1'),
      () => measured,
    );
    await repository.createVitals(validVitals);
    await expect(repository.createVitals(validVitals)).rejects.toThrow();
    expect((await repository.vitals('2026-01-01')).map((row) => row.id)).toEqual(['v1']);
    expect(await repository.pendingCount()).toBe(1);
  });

  it('separa historial, detalle, último registro, síntomas y pendientes por paciente', async () => {
    const database = open();
    await migrateDatabase(database);
    const a = createPatientRepository(
      database,
      patientA,
      ids('av', 'aq', 'as', 'asq'),
      () => measured,
    );
    const b = createPatientRepository(database, patientB, ids('bv', 'bq'), () => measured);
    await a.createVitals(validVitals);
    await a.createSymptom('Síntoma A');
    await b.createVitals({ ...validVitals, pulso: 80 });
    expect((await a.vitals('2026-01-01')).map((row) => row.id)).toEqual(['av']);
    expect((await b.vitals('2026-01-01')).map((row) => row.id)).toEqual(['bv']);
    expect(await b.vital('av')).toBeNull();
    expect((await a.latestVital())?.id).toBe('av');
    expect((await b.latestVital())?.id).toBe('bv');
    expect((await a.symptoms()).map((row) => row.descripcion)).toEqual(['Síntoma A']);
    expect(await b.symptoms()).toEqual([]);
    expect(await a.pendingCount()).toBe(2);
    expect(await b.pendingCount()).toBe(1);
  });

  it('filtra por tiempo y pagina en bloques', async () => {
    const database = open();
    await migrateDatabase(database);
    let n = 0;
    const repository = createPatientRepository(
      database,
      patientA,
      () => `id-${n++}`,
      () => measured,
    );
    for (let i = 0; i < 32; i++) await repository.createVitals(validVitals);
    expect(
      await repository.vitals(sinceDays(7, new Date('2026-09-28T12:30:00Z')), 30),
    ).toHaveLength(30);
    expect(await repository.vitals('2026-09-01', 30, 30)).toHaveLength(2);
    expect(await repository.vitals('2026-09-29')).toHaveLength(0);
  });
});

describe('validación estructural', () => {
  const blank = { temperature: '', systolic: '', diastolic: '', pulse: '', saturation: '' };
  it('acepta coma o punto y mediciones parciales', () => {
    expect(parseVitalInput({ ...blank, temperature: '36,8' }).temperatura).toBe(36.8);
    expect(parseVitalInput({ ...blank, temperature: '36.8' }).temperatura).toBe(36.8);
  });
  it('rechaza mediciones vacías, presión incompleta y números inválidos', () => {
    expect(() => parseVitalInput(blank)).toThrow(InputError);
    expect(() => parseVitalInput({ ...blank, systolic: '120' })).toThrow(InputError);
    expect(() => parseVitalInput({ ...blank, pulse: '72.5' })).toThrow(InputError);
    expect(() => parseVitalInput({ ...blank, saturation: '101' })).toThrow(InputError);
    expect(() => parseVitalInput({ ...blank, temperature: 'Infinity' })).toThrow(InputError);
  });
  it('exige una descripción real de hasta 2.000 caracteres', () => {
    expect(() => parseSymptomDescription('   ')).toThrow(InputError);
    expect(() => parseSymptomDescription('a'.repeat(2001))).toThrow(InputError);
    expect(parseSymptomDescription('  Molestia  ')).toBe('Molestia');
  });
});
