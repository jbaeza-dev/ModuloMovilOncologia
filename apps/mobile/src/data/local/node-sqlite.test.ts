import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { REGISTROS_SQL } from './migrations/001_registros';
import { CONTEXTO_SQL } from './migrations/002_contexto';
import { createPatientRepository, seedPatientContextIfEmpty, sinceDays } from './repository';
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
  it('crea la versión actual y conserva filas tras reabrir y repetir la migración', async () => {
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
    ).toBe(2);
    expect(
      (await createPatientRepository(second, patientA, ids()).vitals('2026-01-01', 30, 0)).map(
        (row) => row.id,
      ),
    ).toEqual(['v1']);
  });

  it('aplica migración incremental 1 -> 2 preservando registros previos', async () => {
    const database = open();
    await migrateDatabase(database, [{ version: 1, sql: REGISTROS_SQL }]);
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(1);
    const repo1 = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 's1', 'q2'),
      () => measured,
    );
    await repo1.createVitals(validVitals);
    await repo1.createSymptom('Molestia previa');

    await migrateDatabase(database);
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(2);

    const repo2 = createPatientRepository(database, patientA, ids());
    expect(await repo2.vitals('2026-01-01')).toHaveLength(1);
    expect(await repo2.symptoms()).toHaveLength(1);

    expect(
      await database.first("SELECT name FROM sqlite_master WHERE name = 'paciente_cache'"),
    ).not.toBeNull();
    expect(
      await database.first("SELECT name FROM sqlite_master WHERE name = 'tratamiento_cache'"),
    ).not.toBeNull();
    expect(
      await database.first(
        "SELECT name FROM sqlite_master WHERE name = 'codigo_vinculacion_cache'",
      ),
    ).not.toBeNull();
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
        { version: 2, sql: CONTEXTO_SQL },
        {
          version: 3,
          sql: 'CREATE TABLE temporal (id TEXT); INSERT INTO inexistente VALUES (1);',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(2);
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

describe('contexto y perfil clínico offline', () => {
  it('puebla datos sintéticos de demostración para paciente A y paciente B con seed', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    const profileA = await repoA.profile();
    const profileB = await repoB.profile();
    expect(profileA?.nombre).toBe('Paciente A de Prueba');
    expect(profileB?.nombre).toBe('Paciente B de Prueba');
    expect(profileA?.rut).toBe('12.345.678-9');
    expect(profileB?.rut).toBe('15.876.543-2');

    const treatmentA = await repoA.treatment();
    const treatmentB = await repoB.treatment();
    expect(treatmentA?.nombre).toContain('Tratamiento de quimioterapia (demostración)');
    expect(treatmentB?.nombre).toContain('Tratamiento de quimioterapia (demostración)');
    expect(treatmentA?.tipo).toBe('quimioterapia');
    expect(treatmentB?.tipo).toBe('quimioterapia');
    expect(JSON.parse(treatmentA?.parametros_json ?? '{}').ciclo_actual).toBe(3);
    expect(JSON.parse(treatmentB?.parametros_json ?? '{}').ciclo_actual).toBe(1);

    // La caché de código de vinculación inicia vacía hasta recibir uno del servicio/simulador
    const codeA = await repoA.linkCode();
    const codeB = await repoB.linkCode();
    expect(codeA).toBeNull();
    expect(codeB).toBeNull();
  });

  it('permite actualizar el perfil y almacena código canónico emitido por el servicio', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    await repoA.saveProfile({
      nombre: 'Paciente A Actualizado',
      email: 'paciente.a.nuevo@quimiocare.test',
      rut: '11.111.111-K',
    });

    const updated = await repoA.profile();
    expect(updated?.nombre).toBe('Paciente A Actualizado');
    expect(updated?.email).toBe('paciente.a.nuevo@quimiocare.test');
    expect(updated?.rut).toBe('11.111.111-K');

    // SQLite almacena el código canónico (6 caracteres alfanuméricos sin espacios)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await repoA.saveLinkCode({
      codigo: 'SRV 891',
      expira_en: expiresAt,
      estado_conocido: 'pendiente',
    });

    const storedCode = await repoA.linkCode();
    expect(storedCode?.codigo).toBe('SRV891');
    expect(storedCode?.expira_en).toBe(expiresAt);
    expect(storedCode?.estado_conocido).toBe('pendiente');
  });

  it('selecciona únicamente el tratamiento activo ignorando tratamientos finalizados', async () => {
    const database = open();
    await migrateDatabase(database);
    const repoA = createPatientRepository(database, patientA, ids());

    await database.run(
      `INSERT INTO paciente_cache (paciente_id, nombre, email, rut, obtenido_en)
       VALUES (?, 'Paciente A', 'a@test.com', '1-9', '2026-09-01T00:00:00Z')`,
      [patientA],
    );
    await database.run(
      `INSERT INTO tratamiento_cache (
        id, paciente_id, tipo, estado, nombre, parametros_json, fecha_inicio, fecha_termino, obtenido_en
      ) VALUES ('t-activo', ?, 'quimioterapia', 'activo', 'Tratamiento Activo', '{"ciclo_actual":2}', '2026-08-01', '2026-12-01', '2026-08-01T00:00:00Z')`,
      [patientA],
    );
    await database.run(
      `INSERT INTO tratamiento_cache (
        id, paciente_id, tipo, estado, nombre, parametros_json, fecha_inicio, fecha_termino, obtenido_en
      ) VALUES ('t-finalizado', ?, 'quimioterapia', 'finalizado', 'Tratamiento Finalizado', '{}', '2026-01-01', '2026-07-01', '2026-09-01T00:00:00Z')`,
      [patientA],
    );

    const active = await repoA.treatment();
    expect(active?.id).toBe('t-activo');
    expect(active?.estado).toBe('activo');
    expect(active?.nombre).toBe('Tratamiento Activo');
  });

  it('hace cumplir las restricciones de clave foránea y no genera violaciones en foreign_key_check', async () => {
    const database = open();
    await migrateDatabase(database);
    await expect(
      database.run(
        `INSERT INTO tratamiento_cache (
          id, paciente_id, tipo, estado, nombre, obtenido_en
        ) VALUES ('t1', 'paciente-no-existe', 'quimioterapia', 'activo', 'Test', '2026-09-28T00:00:00Z')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);

    await expect(
      database.run(
        `INSERT INTO codigo_vinculacion_cache (
          paciente_id, codigo, expira_en, estado_conocido, obtenido_en
        ) VALUES ('paciente-no-existe', 'XYZ123', '2026-09-29T00:00:00Z', 'pendiente', '2026-09-28T00:00:00Z')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);

    const fkIssues = await database.all('PRAGMA foreign_key_check');
    expect(fkIssues).toHaveLength(0);
  });

  it('calcula correctamente el resumen de signos vitales para reportes en rangos de 7, 30 y 90 días con fechas límite', async () => {
    const database = open();
    await migrateDatabase(database);

    let currentTime = '2026-09-26T12:00:00.000Z';
    const repoA = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 'v2', 'q2', 'v3', 'q3', 'v4', 'q4'),
      () => currentTime,
    );

    // Registro 1: medido hace 2 días (dentro de 7, 30 y 90 días)
    currentTime = '2026-09-26T12:00:00.000Z';
    await repoA.createVitals({
      temperatura: 36.5,
      presion_sistolica: 120,
      presion_diastolica: 80,
      pulso: 70,
      saturacion_o2: 98,
    });

    // Registro 2: medido hace 15 días (fuera de 7 días, pero dentro de 30 y 90 días)
    currentTime = '2026-09-13T12:00:00.000Z';
    await repoA.createVitals({
      temperatura: 37.5,
      presion_sistolica: 130,
      presion_diastolica: 85,
      pulso: 80,
      saturacion_o2: 97,
    });

    // Registro 3: medido hace 45 días (fuera de 7 y 30 días, pero dentro de 90 días)
    currentTime = '2026-08-14T12:00:00.000Z';
    await repoA.createVitals({
      temperatura: 38.5,
      presion_sistolica: 135,
      presion_diastolica: 88,
      pulso: 90,
      saturacion_o2: 96,
    });

    // Registro 4: medido hace 100 días (fuera de 7, 30 y 90 días)
    currentTime = '2026-06-20T12:00:00.000Z';
    await repoA.createVitals({
      temperatura: 39.0,
      presion_sistolica: 140,
      presion_diastolica: 90,
      pulso: 100,
      saturacion_o2: 95,
    });

    const reference = new Date('2026-09-28T12:00:00.000Z');

    // Rango 7 días: solo registro 1 (hace 2 días)
    const summary7 = await repoA.vitalsSummary(sinceDays(7, reference));
    expect(summary7.total).toBe(1);
    expect(summary7.avgTemperature).toBe(36.5);
    expect(summary7.avgPulse).toBe(70);

    // Rango 30 días: registros 1 y 2 (hace 2 y 15 días)
    const summary30 = await repoA.vitalsSummary(sinceDays(30, reference));
    expect(summary30.total).toBe(2);
    expect(summary30.avgTemperature).toBe(37); // (36.5 + 37.5) / 2
    expect(summary30.avgPulse).toBe(75); // (70 + 80) / 2

    // Rango 90 días: registros 1, 2 y 3 (hace 2, 15 y 45 días)
    const summary90 = await repoA.vitalsSummary(sinceDays(90, reference));
    expect(summary90.total).toBe(3);
    expect(summary90.avgTemperature).toBe(37.5); // (36.5 + 37.5 + 38.5) / 3
    expect(summary90.avgPulse).toBe(80); // (70 + 80 + 90) / 3

    // Paciente B debe tener 0 registros (aislamiento A/B)
    const repoB = createPatientRepository(database, patientB, ids());
    const summaryB = await repoB.vitalsSummary(sinceDays(90, reference));
    expect(summaryB.total).toBe(0);
    expect(summaryB.avgTemperature).toBeNull();
    expect(summaryB.avgPulse).toBeNull();
  });
});
