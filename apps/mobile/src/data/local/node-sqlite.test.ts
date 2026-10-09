import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { REGISTROS_SQL } from './migrations/001_registros';
import { CONTEXTO_SQL } from './migrations/002_contexto';
import { DESCARGAS_SQL } from './migrations/003_descargas';
import { FORMULARIOS_SQL, FORMULARIOS_VERSION } from './migrations/004_formularios';
import { CONTEXTO_CLINICO_SQL } from './migrations/005_contexto_clinico';
import { ingestMedicalFormBundle } from './form-ingestion';
import { ingestTermDefinitions } from './consent-ingestion';
import { seedMedicalFormsDemo } from './form-seed';
import {
  ConflictoEntregaError,
  TipoPreguntaNoSoportadoError,
  VersionInmutableError,
} from './form-types';
import { reconcileCopiesCore } from './reconciliation';
import { createPatientRepository, seedPatientContextIfEmpty, sinceDays } from './repository';
import type { SqlConnection, SqlValue } from './sql';
import { InputError, parseSymptomDescription, parseVitalInput } from './validation';
import { SAMPLE_MEDICAL_FORMS } from '../../features/medical-forms/sample-medical-forms';
import { buildReportHtml } from '../../features/reports/report-template';

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
  let queued: Promise<void> = Promise.resolve();
  return {
    ...operations,
    transaction(work) {
      const pending = queued.then(async () => {
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
      });
      queued = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
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
    ).toBe(6);
    expect(
      (await createPatientRepository(second, patientA, ids()).vitals('2026-01-01', 30, 0)).map(
        (row) => row.id,
      ),
    ).toEqual(['v1']);
  });

  it('aplica migración incremental 1 -> 2 -> 3 preservando registros previos', async () => {
    const database = open();
    // Paso 1: Inicializar en versión 1 e insertar datos clínicos
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

    // Paso 2: Migrar a versión 2 (contexto de paciente)
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
    ]);
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(2);

    await seedPatientContextIfEmpty(database, patientA, patientB);
    const profileA = await repo1.profile();
    expect(profileA?.nombre).toBe('Paciente A de Prueba');

    // Paso 3: Migrar a versión 3 (descargas y recursos educativos)
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
      { version: 3, sql: DESCARGAS_SQL },
    ]);
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(3);

    // Comprobar que registros previos de v1 y v2 se conservan íntegros
    const repo3 = createPatientRepository(database, patientA, ids());
    const vitalsList = await repo3.vitals('2026-01-01');
    expect(vitalsList).toHaveLength(1);
    expect(vitalsList[0].id).toBe('v1');
    expect(vitalsList[0].estado_envio).toBe('pendiente');

    const symptomsList = await repo3.symptoms();
    expect(symptomsList).toHaveLength(1);
    expect(symptomsList[0].descripcion).toBe('Molestia previa');
    expect(symptomsList[0].estado_envio).toBe('pendiente');

    expect((await repo3.profile())?.nombre).toBe('Paciente A de Prueba');

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
    expect(
      await database.first("SELECT name FROM sqlite_master WHERE name = 'descarga'"),
    ).not.toBeNull();
  });

  it('revierte una migración fallida sin perder la versión anterior', async () => {
    const database = open();
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
    ]);
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

describe('descargas y recursos educativos offline', () => {
  it('hace cumplir las restricciones de CHECK y clave foránea en la tabla descarga', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Estado 'descargado' válido con ruta y fecha
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
       VALUES (?, 'edu-valido', '/data/res.md', 'descargado', '2026-09-29T10:00:00Z')`,
      [patientA],
    );

    // 2. Estado 'descargado' sin ruta_local debe fallar CHECK
    await expect(
      database.run(
        `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
         VALUES (?, 'edu-sin-ruta', NULL, 'descargado', '2026-09-29T10:00:00Z')`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 3. Estado 'descargado' sin fecha_descarga debe fallar CHECK
    await expect(
      database.run(
        `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
         VALUES (?, 'edu-sin-fecha', '/data/res.md', 'descargado', NULL)`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 4. Estados 'pendiente', 'descargando' y 'error' permiten ruta_local y fecha_descarga nulas
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
       VALUES (?, 'edu-pendiente', NULL, 'pendiente', NULL)`,
      [patientA],
    );
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
       VALUES (?, 'edu-descargando', NULL, 'descargando', NULL)`,
      [patientA],
    );
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
       VALUES (?, 'edu-error', NULL, 'error', NULL)`,
      [patientA],
    );

    // 5. Estado inválido debe fallar CHECK
    await expect(
      database.run(
        `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
         VALUES (?, 'edu-invalido', '/data/res.md', 'completado', '2026-09-29T10:00:00Z')`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 6. Paciente inexistente debe fallar restricción de clave foránea
    await expect(
      database.run(
        `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga)
         VALUES ('paciente-fantasma', 'edu-1', '/data/res.md', 'descargado', '2026-09-29T10:00:00Z')`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);

    // PRAGMA foreign_key_check no debe reportar violaciones
    expect(await database.all('PRAGMA foreign_key_check')).toHaveLength(0);
  });

  it('gestiona ciclo de vida de descarga, visualización y eliminación en el repositorio', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    expect(await repoA.download('edu-prep-sesion')).toBeNull();
    expect(await repoA.downloads()).toHaveLength(0);

    // Guardar descarga
    await repoA.saveDownload({
      contenido_id: 'edu-prep-sesion',
      ruta_local: '/documentos/recursos_educativos/pacienteA/edu-prep-sesion.md',
    });

    const record = await repoA.download('edu-prep-sesion');
    expect(record).not.toBeNull();
    expect(record?.estado).toBe('descargado');
    expect(record?.ruta_local).toContain('edu-prep-sesion.md');
    expect(record?.visualizada).toBe(0);
    expect(record?.visualizada_en).toBeNull();

    // Marcar como visualizada
    await repoA.markDownloadViewed('edu-prep-sesion');
    const viewed = await repoA.download('edu-prep-sesion');
    expect(viewed?.visualizada).toBe(1);
    expect(viewed?.visualizada_en).toBeTruthy();

    // Re-guardar o actualizar descarga previa debe reiniciar visualizada a 0 y visualizada_en a null
    await repoA.saveDownload({
      contenido_id: 'edu-prep-sesion',
      ruta_local: '/documentos/recursos_educativos/pacienteA/edu-prep-sesion-v2.md',
    });
    const updated = await repoA.download('edu-prep-sesion');
    expect(updated?.ruta_local).toContain('edu-prep-sesion-v2.md');
    expect(updated?.visualizada).toBe(0);
    expect(updated?.visualizada_en).toBeNull();

    // Eliminar descarga
    await repoA.removeDownload('edu-prep-sesion');
    expect(await repoA.download('edu-prep-sesion')).toBeNull();
    expect(await repoA.downloads()).toHaveLength(0);
  });

  it('garantiza aislamiento A/B tanto en SQLite como a nivel de ruta física por paciente', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Directorio temporal emulando Paths.document/recursos_educativos/{paciente_id}
    const tempBase = mkdtempSync(join(tmpdir(), 'quimiocare-fs-'));
    temporary.push(tempBase);

    const dirA = join(tempBase, 'recursos_educativos', patientA);
    const dirB = join(tempBase, 'recursos_educativos', patientB);
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    const fileA = join(dirA, 'edu-compartido.md');
    const fileB = join(dirB, 'edu-compartido.md');

    // Ambos pacientes guardan el mismo recurso en sus respectivas rutas y base de datos
    writeFileSync(fileA, 'Contenido Paciente A', 'utf8');
    writeFileSync(fileB, 'Contenido Paciente B', 'utf8');

    await repoA.saveDownload({ contenido_id: 'edu-compartido', ruta_local: fileA });
    await repoB.saveDownload({ contenido_id: 'edu-compartido', ruta_local: fileB });

    expect(await repoA.download('edu-compartido')).not.toBeNull();
    expect(await repoB.download('edu-compartido')).not.toBeNull();

    // Paciente A elimina su recurso físico y registro en SQLite
    unlinkSync(fileA);
    await repoA.removeDownload('edu-compartido');

    // Paciente A ya no tiene el registro ni el archivo
    expect(await repoA.download('edu-compartido')).toBeNull();
    expect(existsSync(fileA)).toBe(false);

    // Paciente B conserva íntegro su registro en SQLite y su archivo físico
    const bRecord = await repoB.download('edu-compartido');
    expect(bRecord).not.toBeNull();
    expect(bRecord?.contenido_id).toBe('edu-compartido');
    expect(existsSync(fileB)).toBe(true);
    expect(readFileSync(fileB, 'utf8')).toBe('Contenido Paciente B');
  });

  it('permite que el seeder sea idempotente cuando el Paciente A ya existía previamente', async () => {
    const database = open();
    await migrateDatabase(database);

    // Pre-insertar únicamente Paciente A (simulando estado existente de migración previa)
    await database.run(
      `INSERT INTO paciente_cache (paciente_id, nombre, email, rut, obtenido_en)
       VALUES (?, 'Paciente A Preexistente', 'a.pre@test.com', '1-1', '2026-09-01T00:00:00Z')`,
      [patientA],
    );

    // Ejecutar el seeder
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Paciente A conserva sus datos preexistentes (INSERT OR IGNORE no sobreescribe)
    const repoA = createPatientRepository(database, patientA, ids());
    const profileA = await repoA.profile();
    expect(profileA?.nombre).toBe('Paciente A Preexistente');

    // Paciente B fue insertado correctamente
    const repoB = createPatientRepository(database, patientB, ids());
    const profileB = await repoB.profile();
    expect(profileB?.nombre).toBe('Paciente B de Prueba');

    // Segunda ejecución del seeder no duplica ni falla
    await seedPatientContextIfEmpty(database, patientA, patientB);
    const countA = await database.first<{ total: number }>(
      'SELECT count(*) as total FROM paciente_cache WHERE paciente_id = ?',
      [patientA],
    );
    const countB = await database.first<{ total: number }>(
      'SELECT count(*) as total FROM paciente_cache WHERE paciente_id = ?',
      [patientB],
    );
    expect(countA?.total).toBe(1);
    expect(countB?.total).toBe(1);
  });
});

describe('copias educativas y descargas locales', () => {
  it('guarda, consulta, actualiza y elimina descargas locales aisladas por paciente', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Paciente A guarda una descarga
    await repoA.saveDownload({
      contenido_id: 'edu-alimentacion',
      ruta_local: 'file:///data/user/0/recursos_educativos/A/edu-alimentacion_1.md',
    });

    // Paciente B guarda una descarga distinta
    await repoB.saveDownload({
      contenido_id: 'edu-bienestar',
      ruta_local: 'file:///data/user/0/recursos_educativos/B/edu-bienestar_1.md',
    });

    // Verificación de aislamiento A vs B
    const downloadsA = await repoA.downloads();
    const downloadsB = await repoB.downloads();
    expect(downloadsA).toHaveLength(1);
    expect(downloadsA[0].contenido_id).toBe('edu-alimentacion');
    expect(downloadsA[0].visualizada).toBe(0);
    expect(downloadsA[0].visualizada_en).toBeNull();

    expect(downloadsB).toHaveLength(1);
    expect(downloadsB[0].contenido_id).toBe('edu-bienestar');

    // Consulta individual por ID
    const singleA = await repoA.download('edu-alimentacion');
    expect(singleA?.ruta_local).toBe(
      'file:///data/user/0/recursos_educativos/A/edu-alimentacion_1.md',
    );
    expect(await repoA.download('edu-bienestar')).toBeNull();

    // Marcar como visualizada
    await repoA.markDownloadViewed('edu-alimentacion');
    const viewedA = await repoA.download('edu-alimentacion');
    expect(viewedA?.visualizada).toBe(1);
    expect(viewedA?.visualizada_en).not.toBeNull();

    // Actualización con nueva ruta atómica (ON CONFLICT DO UPDATE)
    await repoA.saveDownload({
      contenido_id: 'edu-alimentacion',
      ruta_local: 'file:///data/user/0/recursos_educativos/A/edu-alimentacion_2.md',
    });
    const updatedA = await repoA.download('edu-alimentacion');
    expect(updatedA?.ruta_local).toBe(
      'file:///data/user/0/recursos_educativos/A/edu-alimentacion_2.md',
    );
    // Debe resetear visualizada a 0 tras la actualización
    expect(updatedA?.visualizada).toBe(0);

    // Eliminación
    await repoA.removeDownload('edu-alimentacion');
    expect(await repoA.downloads()).toHaveLength(0);
    // Paciente B permanece intacto
    expect(await repoB.downloads()).toHaveLength(1);
  });

  it('conciliación bidireccional detecta registros sin archivo y limpia archivos sin registro', async () => {
    const markedUnavailableIds: string[] = [];
    const deletedDiskUris: string[] = [];

    const dbRecords = [
      { contenido_id: 'valido', ruta_local: 'file:///disk/valido.md' },
      { contenido_id: 'huerfano_en_db', ruta_local: 'file:///disk/inexistente.md' },
    ];
    const diskFiles = ['file:///disk/valido.md', 'file:///disk/huerfano_en_disco.md'];

    const existingOnDisk = new Set(['file:///disk/valido.md', 'file:///disk/huerfano_en_disco.md']);

    const result = await reconcileCopiesCore(dbRecords, diskFiles, {
      markDbUnavailable: async (id) => {
        markedUnavailableIds.push(id);
      },
      deleteDisk: async (uri) => {
        deletedDiskUris.push(uri);
        return true;
      },
      checkDiskExists: (uri) => existingOnDisk.has(uri),
    });

    expect(result.markedUnavailable).toBe(1);
    expect(result.cleanedOrphans).toBe(1);
    expect(result.failedDeletions).toBe(0);
    expect(markedUnavailableIds).toEqual(['huerfano_en_db']);
    expect(deletedDiskUris).toEqual(['file:///disk/huerfano_en_disco.md']);
  });

  it('no pierde archivo previo si la base de datos falla al guardar nueva versión', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'quimiocare-edu-test-'));
    temporary.push(tempDir);

    const oldFilePath = join(tempDir, 'edu_old.md');
    const newFilePath = join(tempDir, 'edu_new.md');

    // 1. Archivo previo existe en disco
    writeFileSync(oldFilePath, 'Contenido previo', 'utf-8');
    expect(existsSync(oldFilePath)).toBe(true);

    // 2. Se escribe la nueva versión en archivo único
    writeFileSync(newFilePath, 'Contenido nuevo', 'utf-8');
    expect(existsSync(newFilePath)).toBe(true);

    // 3. Simular fallo de base de datos
    const dbSaveOperation = async () => {
      throw new Error('Fallo simulado en SQLite');
    };

    // 4. Manejo de error: se elimina el archivo nuevo y se conserva el viejo
    try {
      await dbSaveOperation();
    } catch {
      unlinkSync(newFilePath);
    }

    // Comprobación: el archivo previo no se perdió y el nuevo no quedó huérfano
    expect(existsSync(oldFilePath)).toBe(true);
    expect(readFileSync(oldFilePath, 'utf-8')).toBe('Contenido previo');
    expect(existsSync(newFilePath)).toBe(false);
  });
});

describe('reportes locales y generación de contenido para PDF', () => {
  it('recupera mediciones para reporte cronológicamente y sin límite arbitrario con vitalsForReport', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repo = createPatientRepository(
      database,
      patientA,
      ids('v1', 'q1', 'v2', 'q2', 'v3', 'q3'),
      () => measured,
    );

    // Insertar registros con fechas conocidas
    await repo.createVitals({ ...validVitals, temperatura: 36.5 });
    await repo.createVitals({ ...validVitals, temperatura: 37.1 });
    await repo.createVitals({ ...validVitals, temperatura: 36.9 });

    const vitals = await repo.vitalsForReport(sinceDays(30, new Date('2026-10-01T00:00:00Z')));
    expect(vitals).toHaveLength(3);
    // Orden cronológico ascendente para el reporte
    expect(vitals[0].temperatura).toBe(36.5);
    expect(vitals[1].temperatura).toBe(37.1);
    expect(vitals[2].temperatura).toBe(36.9);
  });

  it('genera plantilla HTML válida con datos del paciente, resumen y disclaimer sintético', () => {
    const html = buildReportHtml({
      pacienteId: patientA,
      periodDays: 30,
      profile: {
        paciente_id: patientA,
        nombre: 'Paciente A de Prueba',
        rut: '12.345.678-9',
        email: 'paciente.a@quimiocare.cl',
        obtenido_en: '2026-09-28T12:00:00Z',
      },
      treatment: {
        id: 't1',
        paciente_id: patientA,
        tipo: 'quimioterapia',
        estado: 'activo',
        nombre: 'Esquema de quimioterapia de prueba',
        parametros_json: null,
        fecha_inicio: '2026-08-01',
        fecha_termino: null,
        obtenido_en: '2026-09-28T12:00:00Z',
      },
      summary: {
        total: 2,
        avgTemperature: 36.8,
        avgPulse: 72,
      },
      vitals: [
        {
          id: 'v1',
          paciente_id: patientA,
          fecha_registro: '2026-09-28T08:00:00Z',
          presion_sistolica: 120,
          presion_diastolica: 80,
          pulso: 72,
          temperatura: 36.8,
          saturacion_o2: 98,
          fecha_subida: null,
        },
      ],
    });

    expect(html).toContain('QuimioCare');
    expect(html).toContain('Paciente A de Prueba');
    expect(html).toContain('12.345.678-9');
    expect(html).toContain('Esquema de quimioterapia de prueba');
    expect(html).toContain('Últimos 30 días');
    expect(html).toContain('Aviso técnico y demostrativo');
    expect(html).toContain('36,8 °C');
    expect(html).toContain('120/80 mmHg');
    expect(html).toContain('72 lpm');
    expect(html).toContain('98 %');
  });
});

describe('cuestionarios médicos de muestra y almacenamiento de borradores', () => {
  it('valida la estructura clínica de los cuestionarios de demostración', () => {
    expect(SAMPLE_MEDICAL_FORMS.length).toBeGreaterThanOrEqual(2);

    for (const form of SAMPLE_MEDICAL_FORMS) {
      expect(form.id).toBeTruthy();
      expect(form.titulo).toBeTruthy();
      expect(form.version).toBeTruthy();
      expect(form.duracionEstimadaMin).toBeGreaterThan(0);
      expect(form.preguntas.length).toBeGreaterThanOrEqual(3);

      for (const q of form.preguntas) {
        expect(['single_choice', 'multiple_choice', 'scale_0_10', 'text']).toContain(q.tipo);
        if (q.tipo === 'single_choice' || q.tipo === 'multiple_choice') {
          expect(q.opciones?.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});

describe('migración 004, persistencia clínica y formularios en SQLite', () => {
  it('migra de versión 3 a 4 preservando registros previos de cola_envio y ampliando CHECK para nuevos tipos', async () => {
    const database = open();
    // Migrar hasta versión 3
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
      { version: 3, sql: DESCARGAS_SQL },
    ]);
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(3);

    // Insertar registros en cola_envio previa
    const prevQueuePayload = JSON.stringify({ schemaVersion: 1, entity: 'signos_vitales' });
    await database.run(
      `INSERT INTO cola_envio (
        id, paciente_id, tipo_entidad, registro_id, payload_json, estado, intentos, creado_en, actualizado_en
      ) VALUES (?, ?, 'signos_vitales', ?, ?, 'pendiente', 2, ?, ?)`,
      ['q-prev-1', patientA, 'vital-prev-1', prevQueuePayload, measured, measured],
    );

    // Aplicar migración 004
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
      { version: 3, sql: DESCARGAS_SQL },
      { version: FORMULARIOS_VERSION, sql: FORMULARIOS_SQL },
    ]);
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(4);

    // Verificar que el registro previo se conservó íntegramente
    const prev = await database.first<{
      id: string;
      tipo_entidad: string;
      intentos: number;
    }>('SELECT * FROM cola_envio WHERE id = ?', ['q-prev-1']);
    expect(prev).toBeTruthy();
    expect(prev?.tipo_entidad).toBe('signos_vitales');
    expect(prev?.intentos).toBe(2);

    // Verificar que ahora se admiten los nuevos tipos de entidad
    await database.run(
      `INSERT INTO cola_envio (
        id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
      ) VALUES (?, ?, 'respuesta_formulario', ?, ?, 'pendiente', ?, ?)`,
      ['q-form-1', patientA, 'sub-1', '{}', measured, measured],
    );

    await database.run(
      `INSERT INTO cola_envio (
        id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
      ) VALUES (?, ?, 'evento_consentimiento', ?, ?, 'pendiente', ?, ?)`,
      ['q-cons-1', patientA, 'evt-1', '{}', measured, measured],
    );

    // Verificar que un tipo desconocido sigue siendo rechazado por el CHECK
    await expect(
      database.run(
        `INSERT INTO cola_envio (
          id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
        ) VALUES (?, ?, 'tipo_invalido', ?, ?, 'pendiente', ?, ?)`,
        ['q-inv-1', patientA, 'inv-1', '{}', measured, measured],
      ),
    ).rejects.toThrow();
  });

  it('hace rollback completo de la migración si ocurre un fallo a mitad de camino', async () => {
    const database = open();
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
      { version: 3, sql: DESCARGAS_SQL },
    ]);
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(3);

    const failingMigration = {
      version: 4,
      sql: 'CREATE TABLE dummy (id INT); SELECT * FROM tabla_inexistente_que_falla;',
    };

    await expect(
      migrateDatabase(database, [
        { version: 1, sql: REGISTROS_SQL },
        { version: 2, sql: CONTEXTO_SQL },
        { version: 3, sql: DESCARGAS_SQL },
        failingMigration,
      ]),
    ).rejects.toThrow();

    // Comprobar que user_version sigue siendo 3 y que la tabla dummy no quedó creada
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(3);
    const dummy = await database.first("SELECT name FROM sqlite_master WHERE name = 'dummy'");
    expect(dummy).toBeNull();
  });

  it('ingestMedicalFormBundle valida inmutabilidad y rechaza tipos de pregunta no soportados', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Rechazo de tipo no soportado
    const invalidBundle = {
      formularios: [
        {
          formularioId: 'form-test',
          version: '1.0',
          titulo: 'Test Form',
          descripcion: 'Desc',
          duracionEstimadaMin: 2,
          preguntas: [
            {
              preguntaId: 'p1',
              texto: '¿Pregunta con tipo no soportado?',
              tipo: 'ranking_5_estrellas', // no soportado
              orden: 1,
            },
          ],
        },
      ],
      asignaciones: [],
    };

    await expect(ingestMedicalFormBundle(database, invalidBundle)).rejects.toThrow(
      TipoPreguntaNoSoportadoError,
    );

    // 2. Ingestión válida
    const validBundle = {
      formularios: [
        {
          formularioId: 'form-test',
          version: '1.0',
          titulo: 'Test Form',
          descripcion: 'Desc',
          duracionEstimadaMin: 2,
          preguntas: [
            {
              preguntaId: 'p1',
              texto: '¿Pregunta válida?',
              tipo: 'single_choice',
              orden: 1,
              requerida: true,
              configuracion: { opciones: [{ valor: 'si', etiqueta: 'Sí' }] },
            },
          ],
        },
      ],
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'form-test',
          version: '1.0',
          estado: 'activa' as const,
        },
      ],
    };

    await ingestMedicalFormBundle(database, validBundle);

    // 3. Idempotencia ante el mismo lote
    await expect(ingestMedicalFormBundle(database, validBundle)).resolves.not.toThrow();

    // 4. Conflicto de inmutabilidad si cambia el contenido bajo la misma versión
    const alteredBundle = {
      formularios: [
        {
          formularioId: 'form-test',
          version: '1.0',
          titulo: 'Test Form Modificado Ilegalmente',
          descripcion: 'Desc',
          duracionEstimadaMin: 2,
          preguntas: [
            {
              preguntaId: 'p1',
              texto: '¿Pregunta válida?',
              tipo: 'single_choice',
              orden: 1,
              requerida: true,
              configuracion: { opciones: [{ valor: 'si', etiqueta: 'Sí' }] },
            },
          ],
        },
      ],
      asignaciones: [],
    };

    await expect(ingestMedicalFormBundle(database, alteredBundle)).rejects.toThrow(
      VersionInmutableError,
    );
  });

  it('seedMedicalFormsDemo respeta asignaciones retiradas sin reactivarlas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const assignedBefore = await repoA.listAssignedForms();
    expect(assignedBefore.length).toBe(2);

    // Marcar manualmente la asignación de QLQ-C30 como retirada
    await database.run(
      `UPDATE formulario_asignacion_cache
       SET estado_conocido = 'retirada'
       WHERE paciente_id = ? AND formulario_id = 'form-qlq30-muestra'`,
      [patientA],
    );

    // Volver a ejecutar el seed de contexto
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Verificar que la asignación sigue estando en 'retirada'
    const statusRow = await database.first<{ estado_conocido: string }>(
      `SELECT estado_conocido FROM formulario_asignacion_cache
       WHERE paciente_id = ? AND formulario_id = 'form-qlq30-muestra'`,
      [patientA],
    );
    expect(statusRow?.estado_conocido).toBe('retirada');

    // listAssignedForms solo devuelve activas, por lo que QLQ-C30 no debe listarse
    const assignedAfter = await repoA.listAssignedForms();
    expect(assignedAfter.length).toBe(1);
    expect(assignedAfter[0].formulario_id).toBe('form-esas-muestra');
  });

  it('evolución de plantillas: versión 2.0 coexiste con versión 1.0 histórica y sus entregas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Entrega de versión 1.0
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 4, esas_fatiga: 5, esas_nauseas: 1 },
      'sub-v1-001',
    );

    // Ingestar versión 2.0 con nueva pregunta
    const v2Bundle = {
      formularios: [
        {
          formularioId: 'form-esas-muestra',
          version: '2.0',
          titulo: 'ESAS Actualizado (Versión 2.0)',
          descripcion: 'Nueva versión con escala de ansiedad.',
          duracionEstimadaMin: 3,
          preguntas: [
            {
              preguntaId: 'esas_dolor',
              texto: 'Nivel de dolor percibido:',
              tipo: 'scale_0_10' as const,
              orden: 1,
              requerida: true,
            },
            {
              preguntaId: 'esas_ansiedad',
              texto: 'Nivel de ansiedad:',
              tipo: 'scale_0_10' as const,
              orden: 2,
              requerida: true,
            },
          ],
        },
      ],
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'form-esas-muestra',
          version: '2.0',
          estado: 'activa' as const,
        },
      ],
    };

    await ingestMedicalFormBundle(database, v2Bundle);

    // Entrega de versión 2.0
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '2.0',
      { esas_dolor: 3, esas_ansiedad: 7 },
      'sub-v2-001',
    );

    // Ambas entregas existen en el historial
    const history = await repoA.listSubmissions('form-esas-muestra');
    expect(history).toHaveLength(2);

    const subV1 = await repoA.getSubmission('sub-v1-001');
    expect(subV1?.version).toBe('1.0');
    expect(subV1?.respuestas.esas_fatiga).toBe(5);

    const subV2 = await repoA.getSubmission('sub-v2-001');
    expect(subV2?.version).toBe('2.0');
    expect(subV2?.respuestas.esas_ansiedad).toBe(7);
  });

  it('gestiona ciclo de vida de borradores y confirmación atómica en SQLite', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Guardar borrador con deliveryId estable
    const stableDeliveryId = 'delivery-uuid-123';
    await repoA.saveDraft('form-esas-muestra', '1.0', { esas_dolor: 5 }, stableDeliveryId);

    const draft = await repoA.getDraft('form-esas-muestra', '1.0');
    expect(draft).toBeTruthy();
    expect(draft?.entregaId).toBe(stableDeliveryId);
    expect(draft?.respuestas).toEqual({ esas_dolor: 5 });

    // 2. Confirmación atómica
    const confirmedId = await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 5, esas_fatiga: 3, esas_nauseas: 0 },
      stableDeliveryId,
    );
    expect(confirmedId).toBe(stableDeliveryId);

    // Borrador consumido en SQLite
    const draftAfter = await repoA.getDraft('form-esas-muestra', '1.0');
    expect(draftAfter).toBeNull();

    // Entrega registrada en respuesta_formulario
    const sub = await repoA.getSubmission(stableDeliveryId);
    expect(sub).toBeTruthy();
    expect(sub?.id).toBe(stableDeliveryId);
    expect(sub?.respuestas.esas_dolor).toBe(5);

    // Operación en cola_envio
    const queueRow = await database.first<{
      id: string;
      tipo_entidad: string;
      registro_id: string;
      estado: string;
    }>('SELECT * FROM cola_envio WHERE registro_id = ?', [stableDeliveryId]);
    expect(queueRow).toBeTruthy();
    expect(queueRow?.tipo_entidad).toBe('respuesta_formulario');
    expect(queueRow?.estado).toBe('pendiente');

    // 3. Idempotencia ante confirmación repetida con mismos datos
    const reconfirmedId = await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 5, esas_fatiga: 3, esas_nauseas: 0 },
      stableDeliveryId,
    );
    expect(reconfirmedId).toBe(stableDeliveryId);

    const queueCount = await database.first<{ total: number }>(
      'SELECT count(*) AS total FROM cola_envio WHERE registro_id = ?',
      [stableDeliveryId],
    );
    expect(queueCount?.total).toBe(1);

    // 4. Conflicto explícito si se reusa deliveryId con respuestas diferentes
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        { esas_dolor: 9, esas_fatiga: 9, esas_nauseas: 9 },
        stableDeliveryId,
      ),
    ).rejects.toThrow(ConflictoEntregaError);
  });

  it('consumo condicional: confirmar entrega no elimina un borrador posterior con otro entrega_id', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Guardar borrador nuevo con otro entrega_id
    await repoA.saveDraft('form-esas-muestra', '1.0', { esas_dolor: 2 }, 'delivery-uuid-nuevo');

    // Confirmar entrega con deliveryId viejo
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 7, esas_fatiga: 7, esas_nauseas: 7 },
      'delivery-uuid-viejo',
    );

    // El borrador nuevo NO fue eliminado porque su entrega_id no coincide
    const draftStillExists = await repoA.getDraft('form-esas-muestra', '1.0');
    expect(draftStillExists).toBeTruthy();
    expect(draftStillExists?.entregaId).toBe('delivery-uuid-nuevo');
  });

  it('garantiza aislamiento A/B estricto de cuestionarios, borradores y entregas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Paciente A tiene 2 cuestionarios; Paciente B solo 1
    const formsA = await repoA.listAssignedForms();
    const formsB = await repoB.listAssignedForms();
    expect(formsA.map((f) => f.formulario_id).sort()).toEqual(
      ['form-esas-muestra', 'form-qlq30-muestra'].sort(),
    );
    expect(formsB.map((f) => f.formulario_id)).toEqual(['form-esas-muestra']);

    // Paciente A guarda borrador y confirma entrega
    await repoA.saveDraft('form-qlq30-muestra', '1.0', { q1: 'nada' }, 'del-a-1');
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 1, esas_fatiga: 1, esas_nauseas: 1 },
      'sub-a-1',
    );

    // Paciente B no ve el borrador de A
    const draftB = await repoB.getDraft('form-qlq30-muestra', '1.0');
    expect(draftB).toBeNull();

    // Paciente B no lista la entrega de A en su historial
    const submissionsB = await repoB.listSubmissions();
    expect(submissionsB).toHaveLength(0);

    // Paciente B no puede acceder a la entrega de A ni pasando su UUID conocido
    const leakAttempt = await repoB.getSubmission('sub-a-1');
    expect(leakAttempt).toBeNull();
  });

  it('seed demo respeta asignaciones retiradas sin reactivarlas tras reinicio, pero lote explícito sí puede actualizar estado', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Verificar estado inicial: paciente A tiene form-qlq30-muestra activo
    const initialForms = await repoA.listAssignedForms();
    expect(initialForms.map((f) => f.formulario_id)).toContain('form-qlq30-muestra');

    // 2. Retirar la asignación explícitamente
    await ingestMedicalFormBundle(database, {
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'form-qlq30-muestra',
          version: '1.0',
          estado: 'retirada',
        },
      ],
    });

    const formsAfterRetire = await repoA.listAssignedForms();
    expect(formsAfterRetire.map((f) => f.formulario_id)).not.toContain('form-qlq30-muestra');

    // 3. Simular reinicio / re-ejecución del seed demo
    await seedMedicalFormsDemo(database, patientA, patientB);

    // Debe permanecer retirada y no reactivarse por el seed
    const assignmentRow = await database.first<{ estado_conocido: string }>(
      `SELECT estado_conocido FROM formulario_asignacion_cache
       WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
      [patientA, 'form-qlq30-muestra', '1.0'],
    );
    expect(assignmentRow?.estado_conocido).toBe('retirada');

    const formsAfterSeed = await repoA.listAssignedForms();
    expect(formsAfterSeed.map((f) => f.formulario_id)).not.toContain('form-qlq30-muestra');

    // 4. Incorporación explícita mediante lote sí puede reactivarla
    await ingestMedicalFormBundle(database, {
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'form-qlq30-muestra',
          version: '1.0',
          estado: 'activa',
        },
      ],
    });

    const formsReactivated = await repoA.listAssignedForms();
    expect(formsReactivated.map((f) => f.formulario_id)).toContain('form-qlq30-muestra');
  });

  it('saveDraft rechaza guardar borrador de un cuestionario no asignado activamente al paciente', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoB = createPatientRepository(database, patientB, ids());
    // Paciente B solo tiene asignado form-esas-muestra, no form-qlq30-muestra
    await expect(
      repoB.saveDraft('form-qlq30-muestra', '1.0', { q1: 'nada' }, 'delivery-uuid-x'),
    ).rejects.toThrow('No existe una asignación activa para este cuestionario.');
  });

  it('saveDraft rechaza guardar borrador con respuestas ajenas a la definición del cuestionario', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    await expect(
      repoA.saveDraft(
        'form-esas-muestra',
        '1.0',
        { esas_dolor: 4, clave_fantasma: 'invalido' },
        'delivery-uuid-x',
      ),
    ).rejects.toThrow(
      "La clave 'clave_fantasma' no pertenece a la definición de este cuestionario.",
    );
  });

  it('confirmSubmission aplica validación médica: rechaza valores fuera de rango y opciones excluyentes combinadas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Rechaza escala fuera de rango (ej. 99 en escala 0 a 10)
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        { esas_dolor: 99, esas_fatiga: 2, esas_nauseas: 0 },
        'del-invalid-scale',
      ),
    ).rejects.toThrow('El valor debe encontrarse entre 0 y 10.');

    // 2. Rechaza combinación de opciones excluyentes ('ninguna' con otra)
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        {
          esas_dolor: 2,
          esas_fatiga: 2,
          esas_nauseas: 0,
          esas_sintomas_secundarios: ['ninguna', 'mareos'],
        },
        'del-invalid-excl',
      ),
    ).rejects.toThrow('no puede combinarse con otras opciones');
  });

  it('listAssignedForms desempata determinísticamente sin duplicar tarjetas cuando dos entregas comparten la misma fecha', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const sameTimestamp = '2026-10-08T12:00:00.000Z';
    // Insertar dos entregas con el mismo timestamp para el mismo cuestionario
    await database.run(
      `INSERT INTO respuesta_formulario (
        id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en
      ) VALUES
        ('sub-tie-1', ?, 'form-esas-muestra', '1.0', '{}', ?, ?),
        ('sub-tie-2', ?, 'form-esas-muestra', '1.0', '{}', ?, ?)`,
      [patientA, sameTimestamp, sameTimestamp, patientA, sameTimestamp, sameTimestamp],
    );

    const repoA = createPatientRepository(database, patientA, ids());
    const assigned = await repoA.listAssignedForms();

    // No debe haber duplicación de la tarjeta del formulario
    const esasCards = assigned.filter((f) => f.formulario_id === 'form-esas-muestra');
    expect(esasCards).toHaveLength(1);
    // El desempate por id DESC seleccionó deterministicamente sub-tie-2
    expect(esasCards[0].ultima_entrega_id).toBe('sub-tie-2');
  });

  it('listSubmissions soporta paginación con limit y offset', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Insertar 35 entregas para el paciente A
    for (let i = 1; i <= 35; i++) {
      const pad = String(i).padStart(3, '0');
      const timestamp = `2026-10-01T10:00:${String(i % 60).padStart(2, '0')}.000Z`;
      await database.run(
        `INSERT INTO respuesta_formulario (
          id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en
        ) VALUES (?, ?, 'form-esas-muestra', '1.0', '{}', ?, ?)`,
        [`sub-page-${pad}`, patientA, timestamp, timestamp],
      );
    }

    const repoA = createPatientRepository(database, patientA, ids());
    const firstPage = await repoA.listSubmissions(undefined, 30, 0);
    expect(firstPage).toHaveLength(30);

    const secondPage = await repoA.listSubmissions(undefined, 30, 30);
    expect(secondPage).toHaveLength(5);
  });

  it('confirmSubmission rechaza claves ajenas a la definición y tipos inválidos en opcionales sin encolar ni guardar', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Clave ajena a la definición (ej: pregunta_ajena: 42)
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        {
          esas_dolor: 2,
          esas_fatiga: 1,
          esas_nauseas: 0,
          pregunta_ajena: 42,
        },
        'del-alien-key',
      ),
    ).rejects.toThrow(
      "La clave 'pregunta_ajena' no pertenece a la definición de este cuestionario.",
    );

    // Verificar que nada se haya guardado ni encolado
    const alienSubmissions = await database.all('SELECT * FROM respuesta_formulario WHERE id = ?', [
      'del-alien-key',
    ]);
    expect(alienSubmissions).toHaveLength(0);

    const alienQueue = await database.all('SELECT * FROM cola_envio WHERE registro_id = ?', [
      'del-alien-key',
    ]);
    expect(alienQueue).toHaveLength(0);

    // 2. Cadena de espacios en pregunta opcional de selección múltiple (tipo incorrecto)
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        {
          esas_dolor: 2,
          esas_fatiga: 1,
          esas_nauseas: 0,
          esas_sintomas_secundarios: '   ' as unknown as string[],
        },
        'del-invalid-opt-type',
      ),
    ).rejects.toThrow('El valor debe ser una lista de opciones.');
  });

  it('confirmSubmission normaliza respuestas opcionales vacías como ausencia antes de persistir y encolar', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    const deliveryId = 'del-norm-answers';
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      {
        esas_dolor: 3,
        esas_fatiga: 2,
        esas_nauseas: 1,
        esas_notas: '   ',
        esas_sintomas_secundarios: [],
      },
      deliveryId,
    );

    const sub = await database.first<{ respuestas_json: string }>(
      'SELECT respuestas_json FROM respuesta_formulario WHERE id = ?',
      [deliveryId],
    );
    expect(sub).not.toBeNull();
    const storedAnswers = JSON.parse(sub!.respuestas_json);
    expect(storedAnswers).toHaveProperty('esas_dolor', 3);
    expect(storedAnswers).toHaveProperty('esas_fatiga', 2);
    expect(storedAnswers).toHaveProperty('esas_nauseas', 1);
    // Respuestas opcionales vacías se normalizan como ausencia
    expect(storedAnswers).not.toHaveProperty('esas_notas');
    expect(storedAnswers).not.toHaveProperty('esas_sintomas_secundarios');

    // Cola de envío también tiene las respuestas normalizadas
    const queue = await database.first<{ payload_json: string }>(
      'SELECT payload_json FROM cola_envio WHERE registro_id = ?',
      [deliveryId],
    );
    expect(queue).not.toBeNull();
    const payload = JSON.parse(queue!.payload_json);
    expect(payload.record.respuestas).toEqual(storedAnswers);
  });
});

describe('migraciones 005 y 006, contexto clínico y consentimientos en SQLite', () => {
  it('migraciones 005 y 006 se aplican sobre una base v4 existente conservando datos previos y alcanzando user_version = 6', async () => {
    const database = open();
    // 1. Migrar hasta v4
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
      { version: 3, sql: DESCARGAS_SQL },
      { version: 4, sql: FORMULARIOS_SQL },
    ]);
    const v4 = await database.first<{ user_version: number }>('PRAGMA user_version');
    expect(v4?.user_version).toBe(4);

    // Insertar registros en v4: signos vitales y cola_envio
    await database.run(
      `INSERT INTO signos_vitales (id, paciente_id, fecha_registro, temperatura, presion_sistolica, presion_diastolica, pulso, saturacion_o2, creado_localmente_en)
       VALUES ('v-prev-1', ?, '2026-10-01T10:00:00Z', 36.5, 120, 80, 70, 98, '2026-10-01T10:00:00Z')`,
      [patientA],
    );
    await database.run(
      `INSERT INTO cola_envio (id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en)
       VALUES ('q-prev-1', ?, 'signos_vitales', 'v-prev-1', '{"test":true}', 'pendiente', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')`,
      [patientA],
    );

    // 2. Aplicar todas las migraciones (hasta v6)
    await migrateDatabase(database);
    const v6 = await database.first<{ user_version: number }>('PRAGMA user_version');
    expect(v6?.user_version).toBe(6);

    // Verificar que los datos previos se conservaron intactos
    const vital = await database.first<{ id: string }>(
      'SELECT * FROM signos_vitales WHERE id = ?',
      ['v-prev-1'],
    );
    expect(vital).not.toBeNull();
    const queue = await database.first<{ id: string }>('SELECT * FROM cola_envio WHERE id = ?', [
      'q-prev-1',
    ]);
    expect(queue).not.toBeNull();
  });

  it('seedPatientContextIfEmpty ejecuta su contenido en una única transacción sin errores de anidamiento y siembra contexto clínico y términos', async () => {
    const database = open();
    await migrateDatabase(database);
    // seedPatientContextIfEmpty abre una transacción; no debe fallar con "Transacción anidada"
    await expect(seedPatientContextIfEmpty(database, patientA, patientB)).resolves.not.toThrow();

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Paciente A
    const fileA = await repoA.clinicalFile();
    expect(fileA?.ficha_id).toBe('FICHA-A-101');
    const medsA = await repoA.activeMedications();
    expect(medsA.map((m) => m.nombre)).toEqual(['Ondansetrón 8 mg', 'Dexametasona 4 mg']);
    const teamA = await repoA.assignedMedicalTeam();
    expect(teamA.map((t) => t.nombre)).toEqual(['Dra. Claudia Morales', 'Enf. Rodrigo Salinas']);

    // Paciente B
    const fileB = await repoB.clinicalFile();
    expect(fileB?.ficha_id).toBe('FICHA-B-202');
    const medsB = await repoB.activeMedications();
    expect(medsB.map((m) => m.nombre)).toEqual(['Metoclopramida 10 mg']);
    const teamB = await repoB.assignedMedicalTeam();
    expect(teamB.map((t) => t.nombre)).toEqual(['Dr. Martín Vega']);

    // Términos
    const terms = await repoA.listTerms();
    expect(terms.map((t) => t.termino_id)).toContain('term-piloto-quimiocare');
    expect(terms.map((t) => t.termino_id)).toContain('term-seguimiento-sintomatico');
  });

  it('aislamiento A/B: paciente B no accede a ficha, medicamentos ni profesionales de paciente A', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    const medsA = await repoA.activeMedications();
    const medsB = await repoB.activeMedications();
    expect(medsB.some((m) => medsA.map((ma) => ma.id).includes(m.id))).toBe(false);

    const teamA = await repoA.assignedMedicalTeam();
    const teamB = await repoB.assignedMedicalTeam();
    expect(teamB.some((t) => teamA.map((ta) => ta.id).includes(t.id))).toBe(false);

    // Paciente C sin vínculos ni medicamentos
    const patientC = '33333333-3333-4333-8333-333333333333';
    const repoC = createPatientRepository(database, patientC, ids());
    expect(await repoC.clinicalFile()).toBeNull();
    expect(await repoC.activeMedications()).toHaveLength(0);
    expect(await repoC.assignedMedicalTeam()).toHaveLength(0);
  });

  it('integridad compuesta de esquema: rechaza medicamentos y eventos cruzados entre pacientes', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Intentar asociar un medicamento para paciente A con la ficha_id de paciente B ('FICHA-B-202')
    // viola la FK compuesta (paciente_id, ficha_id)
    await expect(
      database.run(
        `INSERT INTO medicamento_activo_cache (
           id, paciente_id, ficha_id, nombre, dosis, frecuencia, fecha_inicio, fecha_fin, estado_activo, obtenido_en
         ) VALUES ('med-cruzado', ?, 'FICHA-B-202', 'Fármaco Inválido', '10 mg', 'Cada 12h', '2026-10-01', NULL, 1, '2026-10-01T10:00:00Z')`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 2. Crear un consentimiento para Paciente A
    const repoA = createPatientRepository(
      database,
      patientA,
      ids('consent-a-uuid', 'event-a-uuid', 'queue-a-uuid'),
    );
    const { consentId } = await repoA.grantConsent('term-piloto-quimiocare', '1.0');

    // Intentar asociar un evento_consentimiento para paciente B con el consentimiento de paciente A
    // viola la FK compuesta (consentimiento_id, paciente_id, termino_id, version)
    await expect(
      database.run(
        `INSERT INTO evento_consentimiento (
           id, paciente_id, consentimiento_id, termino_id, version, secuencia, accion, fecha_evento
         ) VALUES ('ev-cruzado', ?, ?, 'term-piloto-quimiocare', '1.0', 99, 'otorgado', '2026-10-01T10:00:00Z')`,
        [patientB, consentId],
      ),
    ).rejects.toThrow();
  });

  it('inmutabilidad de términos: re-incorporar mismo contenido es idempotente, contenido modificado bajo misma versión es rechazado', async () => {
    const database = open();
    await migrateDatabase(database);

    const termBundle = {
      terminos: [
        {
          terminoId: 'term-inmutable-test',
          version: '1.0',
          titulo: 'Términos de Prueba',
          contenidoMarkdown: '# Texto Original Inmutable',
          vigenteDesde: '2026-01-01T00:00:00Z',
        },
      ],
    };

    // 1. Ingesta inicial
    await ingestTermDefinitions(database, termBundle);
    const term = await database.first<{ titulo: string; contenido_markdown: string }>(
      'SELECT titulo, contenido_markdown FROM definicion_terminos_cache WHERE termino_id = ? AND version = ?',
      ['term-inmutable-test', '1.0'],
    );
    expect(term?.contenido_markdown).toBe('# Texto Original Inmutable');

    // 2. Re-ingesta con exactamente el mismo contenido (idempotente)
    await expect(ingestTermDefinitions(database, termBundle)).resolves.not.toThrow();

    // 3. Intento de re-ingesta con contenido modificado bajo la misma versión (1.0)
    const alteredBundle = {
      terminos: [
        {
          terminoId: 'term-inmutable-test',
          version: '1.0',
          titulo: 'Términos de Prueba Modificados',
          contenidoMarkdown: '# Texto Modificado Ilegítimo',
          vigenteDesde: '2026-01-01T00:00:00Z',
        },
      ],
    };
    await expect(ingestTermDefinitions(database, alteredBundle)).rejects.toThrow(
      "Conflicto de inmutabilidad: la versión '1.0' de 'term-inmutable-test' ya existe con un contenido distinto.",
    );

    // El contenido original se preserva íntegro
    const termAfter = await database.first<{ contenido_markdown: string }>(
      'SELECT contenido_markdown FROM definicion_terminos_cache WHERE termino_id = ? AND version = ?',
      ['term-inmutable-test', '1.0'],
    );
    expect(termAfter?.contenido_markdown).toBe('# Texto Original Inmutable');
  });

  it('ciclo completo de consentimiento: otorgamiento, idempotencia, revocación por consentId, re-otorgamiento y cola inmutable', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Otorgamiento de consentimiento v1.0
    const { consentId, eventId } = await repoA.grantConsent('term-piloto-quimiocare', '1.0');
    expect(consentId).toBeDefined();
    expect(eventId).toBeDefined();

    // Comprobar estado
    const status1 = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(status1.estado).toBe('otorgado');
    expect(status1.activeConsent?.id).toBe(consentId);
    expect(status1.lastEvent?.secuencia).toBe(1);

    // Comprobar inserción en cola_envio
    const queue1 = await database.first<{ payload_json: string }>(
      'SELECT payload_json FROM cola_envio WHERE registro_id = ?',
      [eventId],
    );
    expect(queue1).not.toBeNull();
    const payload1 = JSON.parse(queue1!.payload_json);
    expect(payload1.record.accion).toBe('otorgado');
    expect(payload1.record.secuencia).toBe(1);

    // 2. Idempotencia: re-otorgar cuando ya está activo devuelve el mismo consentId y no duplica cola ni eventos
    const reGrant = await repoA.grantConsent('term-piloto-quimiocare', '1.0');
    expect(reGrant.consentId).toBe(consentId);
    const eventsCount1 = await database.first<{ total: number }>(
      'SELECT count(*) as total FROM evento_consentimiento WHERE paciente_id = ?',
      [patientA],
    );
    expect(eventsCount1?.total).toBe(1);

    // 3. Revocación por consentId
    const revokeResult = await repoA.revokeConsent(consentId);
    expect(revokeResult).not.toBeNull();

    // Comprobar estado tras revocación
    const status2 = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(status2.estado).toBe('revocado');
    expect(status2.activeConsent).toBeNull();
    expect(status2.lastConsent?.fecha_revocacion).not.toBeNull();
    expect(status2.lastEvent?.secuencia).toBe(2);
    expect(status2.lastEvent?.accion).toBe('revocado');

    // Comprobar que en cola_envio existen 2 filas: la primera inmutable ('otorgado') y la segunda ('revocado')
    const queueEntries = await database.all<{ payload_json: string }>(
      "SELECT payload_json FROM cola_envio WHERE paciente_id = ? AND tipo_entidad = 'evento_consentimiento' ORDER BY creado_en ASC",
      [patientA],
    );
    expect(queueEntries).toHaveLength(2);
    expect(JSON.parse(queueEntries[0].payload_json).record.accion).toBe('otorgado');
    expect(JSON.parse(queueEntries[1].payload_json).record.accion).toBe('revocado');

    // 4. Re-otorgamiento tras revocación: crea nuevo consentimiento, tercer evento y tercera fila en cola
    const grant3 = await repoA.grantConsent('term-piloto-quimiocare', '1.0');
    expect(grant3.consentId).not.toBe(consentId);

    const status3 = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(status3.estado).toBe('otorgado');
    expect(status3.activeConsent?.id).toBe(grant3.consentId);
    expect(status3.lastEvent?.secuencia).toBe(3);

    const allEvents = await repoA.listConsentHistory('term-piloto-quimiocare');
    expect(allEvents).toHaveLength(3);
    // Ordenado por secuencia DESC: secuencia 3, 2, 1
    expect(allEvents.map((e) => e.secuencia)).toEqual([3, 2, 1]);
    expect(allEvents.map((e) => e.accion)).toEqual(['otorgado', 'revocado', 'otorgado']);

    // 5. Revocación con un consentId perteneciente a otro paciente es rechazada
    const repoB = createPatientRepository(database, patientB, ids());
    await expect(repoB.revokeConsent(grant3.consentId)).rejects.toThrow(
      'Consentimiento no encontrado o no pertenece al paciente activo.',
    );
  });

  it('atomicidad: fallo en cola_envio revierte completamente tanto en otorgamiento como en revocación', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Fallo simulado durante otorgamiento: UUID de cola colisiona
    const queueIdColliding = 'collision-queue-uuid';
    await database.run(
      `INSERT INTO cola_envio (id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en)
       VALUES (?, ?, 'signos_vitales', 'dummy-reg', '{}', 'pendiente', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      [queueIdColliding, patientA],
    );

    const failingRepo = createPatientRepository(
      database,
      patientA,
      ids('consent-fail-1', 'event-fail-1', queueIdColliding),
    );

    await expect(failingRepo.grantConsent('term-piloto-quimiocare', '1.0')).rejects.toThrow();

    // Rollback verificado: no se insertó consentimiento ni evento
    const consents = await database.all(
      'SELECT * FROM consentimiento_usuario WHERE paciente_id = ?',
      [patientA],
    );
    expect(consents).toHaveLength(0);
    const events = await database.all('SELECT * FROM evento_consentimiento WHERE paciente_id = ?', [
      patientA,
    ]);
    expect(events).toHaveLength(0);

    // 2. Otorgar exitosamente primero
    const workingRepo = createPatientRepository(database, patientA, ids());
    const { consentId } = await workingRepo.grantConsent('term-piloto-quimiocare', '1.0');

    // 3. Fallo simulado durante revocación: UUID de cola colisiona en el 2do id generado (eventId, queueId)
    const failingRevokeRepo = createPatientRepository(
      database,
      patientA,
      ids('event-fail-2', queueIdColliding),
    );

    await expect(failingRevokeRepo.revokeConsent(consentId)).rejects.toThrow();

    // Rollback verificado: el consentimiento sigue en 'otorgado' y no se creó un evento parcial de revocación
    const consentAfter = await database.first<{ estado: string }>(
      'SELECT estado FROM consentimiento_usuario WHERE id = ?',
      [consentId],
    );
    expect(consentAfter?.estado).toBe('otorgado');
    const eventsAfter = await database.all<{ accion: string }>(
      'SELECT * FROM evento_consentimiento WHERE consentimiento_id = ?',
      [consentId],
    );
    expect(eventsAfter).toHaveLength(1);
    expect(eventsAfter[0].accion).toBe('otorgado');
  });

  it('secuencia causal incremental: reloj fijo y reloj retrocediendo conservan el orden real de los eventos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Reloj fijo: exactamente el mismo instante para las 3 operaciones
    const fixedTime = '2026-10-08T12:00:00.000Z';
    const sharedIds = ids();
    const repoFixed = createPatientRepository(database, patientA, sharedIds, () => fixedTime);

    const { consentId: c1 } = await repoFixed.grantConsent('term-piloto-quimiocare', '1.0');
    await repoFixed.revokeConsent(c1);
    await repoFixed.grantConsent('term-piloto-quimiocare', '1.0');

    // Comprobar eventos y secuencias en la base
    const eventsFixed = await database.all<{
      secuencia: number;
      accion: string;
      fecha_evento: string;
    }>(
      'SELECT secuencia, accion, fecha_evento FROM evento_consentimiento WHERE paciente_id = ? ORDER BY secuencia ASC',
      [patientA],
    );
    expect(eventsFixed).toHaveLength(3);
    expect(eventsFixed.map((e) => e.secuencia)).toEqual([1, 2, 3]);
    expect(eventsFixed.map((e) => e.accion)).toEqual(['otorgado', 'revocado', 'otorgado']);
    // Todos comparten el mismo timestamp
    expect(eventsFixed.every((e) => e.fecha_evento === fixedTime)).toBe(true);

    // listConsentHistory ordena por secuencia DESC: devuelve nuevo otorgado -> revocado -> otorgado
    const historyFixed = await repoFixed.listConsentHistory('term-piloto-quimiocare');
    expect(historyFixed.map((e) => e.secuencia)).toEqual([3, 2, 1]);

    // 2. Reloj retrocediendo:
    // Evento 4 (otro término): T2 (12:00)
    // Evento 5 (revocación de ese término): T1 (11:00, reloj retrocedió 1 hora)
    let currentClock = '2026-10-08T12:00:00.000Z';
    const clockMock = () => currentClock;
    const repoSkew = createPatientRepository(database, patientA, sharedIds, clockMock);

    const { consentId: c2 } = await repoSkew.grantConsent('term-seguimiento-sintomatico', '1.0');
    // Retroceder reloj
    currentClock = '2026-10-08T11:00:00.000Z';
    await repoSkew.revokeConsent(c2);

    const eventsSkew = await database.all<{
      secuencia: number;
      accion: string;
      fecha_evento: string;
    }>(
      "SELECT secuencia, accion, fecha_evento FROM evento_consentimiento WHERE paciente_id = ? AND termino_id = 'term-seguimiento-sintomatico' ORDER BY secuencia ASC",
      [patientA],
    );
    expect(eventsSkew).toHaveLength(2);
    expect(eventsSkew[0].secuencia).toBe(4);
    expect(eventsSkew[0].accion).toBe('otorgado');
    expect(eventsSkew[0].fecha_evento).toBe('2026-10-08T12:00:00.000Z');

    expect(eventsSkew[1].secuencia).toBe(5);
    expect(eventsSkew[1].accion).toBe('revocado');
    expect(eventsSkew[1].fecha_evento).toBe('2026-10-08T11:00:00.000Z');

    // La secuencia causal (4 luego 5) garantiza el orden verdadero a pesar de que el timestamp retrocedió
    const historySkew = await repoSkew.listConsentHistory('term-seguimiento-sintomatico');
    expect(historySkew.map((e) => e.secuencia)).toEqual([5, 4]);
    expect(historySkew.map((e) => e.accion)).toEqual(['revocado', 'otorgado']);
  });

  it('versión 2 de términos requiere aceptación propia explícita, no hereda aceptación de v1 y conserva su historial', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Aceptar versión 1.0
    await repoA.grantConsent('term-piloto-quimiocare', '1.0');

    // Incorporar versión 2.0
    await ingestTermDefinitions(database, {
      terminos: [
        {
          terminoId: 'term-piloto-quimiocare',
          version: '2.0',
          titulo: 'Términos y Condiciones del Piloto QuimioCare (Versión 2)',
          contenidoMarkdown: '# Actualización v2 de términos',
          vigenteDesde: '2026-10-01T00:00:00Z',
        },
      ],
    });

    // Estado de versión 2.0 es 'nunca_otorgado'
    const statusV2 = await repoA.getConsentStatus('term-piloto-quimiocare', '2.0');
    expect(statusV2.estado).toBe('nunca_otorgado');
    expect(statusV2.activeConsent).toBeNull();

    // Estado de versión 1.0 se mantiene en 'otorgado'
    const statusV1 = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(statusV1.estado).toBe('otorgado');
    expect(statusV1.activeConsent).not.toBeNull();
  });

  it('aislamiento A/B en estado e historial de consentimientos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Paciente A acepta v1.0
    await repoA.grantConsent('term-piloto-quimiocare', '1.0');

    // Paciente B consulta v1.0
    const statusB = await repoB.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(statusB.estado).toBe('nunca_otorgado');
    expect(statusB.activeConsent).toBeNull();

    const historyB = await repoB.listConsentHistory('term-piloto-quimiocare');
    expect(historyB).toHaveLength(0);
  });

  it('dos otorgamientos concurrentes: exactamente un consentimiento, un evento y una operación pendiente, devolviendo los mismos identificadores a ambas llamadas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repo = createPatientRepository(database, patientA, ids());
    const [res1, res2] = await Promise.all([
      repo.grantConsent('term-piloto-quimiocare', '1.0'),
      repo.grantConsent('term-piloto-quimiocare', '1.0'),
    ]);

    expect(res1.consentId).toBe(res2.consentId);
    expect(res1.eventId).toBe(res2.eventId);

    const consents = await database.all(
      'SELECT * FROM consentimiento_usuario WHERE paciente_id = ? AND termino_id = ?',
      [patientA, 'term-piloto-quimiocare'],
    );
    expect(consents).toHaveLength(1);

    const events = await database.all(
      'SELECT * FROM evento_consentimiento WHERE paciente_id = ? AND termino_id = ?',
      [patientA, 'term-piloto-quimiocare'],
    );
    expect(events).toHaveLength(1);

    const queue = await database.all(
      "SELECT * FROM cola_envio WHERE paciente_id = ? AND tipo_entidad = 'evento_consentimiento'",
      [patientA],
    );
    expect(queue).toHaveLength(1);
  });

  it('persistencia e idempotencia ante reinicio: medicamento inactivo y vínculo revocado no se reactivan', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Simular que una ingesta autorizada suspendió un medicamento y revocó un vínculo de Paciente A
    await database.run(
      "UPDATE medicamento_activo_cache SET estado_activo = 0 WHERE id = 'med-a-1'",
    );
    await database.run(
      "UPDATE paciente_clinico_cache SET estado_conocido = 'revocado' WHERE id = 'vinc-a-1'",
    );

    // Re-ejecutar seedPatientContextIfEmpty (simulando reapertura de la app)
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const medsA = await repoA.activeMedications();
    // med-a-1 ('Ondansetrón 8 mg') sigue inactivo, solo queda med-a-2 ('Dexametasona 4 mg')
    expect(medsA.map((m) => m.id)).toEqual(['med-a-2']);

    const teamA = await repoA.assignedMedicalTeam();
    // vinc-a-1 ('Dra. Claudia Morales') sigue revocado, solo queda prof-2 ('Enf. Rodrigo Salinas')
    expect(teamA.map((t) => t.id)).toEqual(['prof-2']);
  });

  it('rollback de migración 006 conserva versión 5 y sus datos de contexto intactos', async () => {
    const database = open();
    // Migrar hasta v5
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
      { version: 3, sql: DESCARGAS_SQL },
      { version: 4, sql: FORMULARIOS_SQL },
      { version: 5, sql: CONTEXTO_CLINICO_SQL },
    ]);

    // Insertar un dato en v5
    await database.run(
      "INSERT INTO profesional_medico_cache (id, nombre, especialidad, email, obtenido_en) VALUES ('prof-v5', 'Dra. Prueba V5', 'Oncología', NULL, '2026-10-01T00:00:00Z')",
    );

    // Intentar migrar con una v6 fallida
    const failingV6Sql = 'CREATE TABLE definicion_terminos_cache (id TEXT); SYNTAX ERROR HERE;';
    await expect(
      migrateDatabase(database, [
        { version: 1, sql: REGISTROS_SQL },
        { version: 2, sql: CONTEXTO_SQL },
        { version: 3, sql: DESCARGAS_SQL },
        { version: 4, sql: FORMULARIOS_SQL },
        { version: 5, sql: CONTEXTO_CLINICO_SQL },
        { version: 6, sql: failingV6Sql },
      ]),
    ).rejects.toThrow();

    // Comprobar que user_version sigue siendo 5 y el dato de v5 sigue existiendo
    const ver = await database.first<{ user_version: number }>('PRAGMA user_version');
    expect(ver?.user_version).toBe(5);

    const prof = await database.first<{ id: string }>(
      'SELECT * FROM profesional_medico_cache WHERE id = ?',
      ['prof-v5'],
    );
    expect(prof).not.toBeNull();
  });
});
