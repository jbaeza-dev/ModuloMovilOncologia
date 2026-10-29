import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { REGISTROS_SQL } from './migrations/001_registros';
import { CONTEXTO_SQL } from './migrations/002_contexto';
import { DESCARGAS_SQL } from './migrations/003_descargas';
import { FORMULARIOS_SQL, FORMULARIOS_VERSION } from './migrations/004_formularios';
import { CONTEXTO_CLINICO_SQL } from './migrations/005_contexto_clinico';
import { CONSENTIMIENTOS_SQL } from './migrations/006_consentimientos';
import { createPatientRepository, seedPatientContextIfEmpty } from './repository';
import {
  createSqliteTestHarness,
  ids,
  measured,
  patientA,
  patientB,
  validVitals,
} from './testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('migraciones SQLite', () => {
  it('crea la versión actual y conserva filas tras reabrir y repetir la migración', async () => {
    const directory = harness.createTempDir('quimiocare-sqlite-');
    const file = join(directory, 'local.db');
    const first = open(file);
    await migrateDatabase(first);
    const repository = createPatientRepository(first, patientA, ids('v1', 'q1'), () => measured);
    await repository.createVitals(validVitals);
    harness.closeLastOpened();

    const second = open(file);
    await migrateDatabase(second);
    expect(
      (await second.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(13);
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
    await database.exec('PRAGMA user_version = 14');
    await expect(migrateDatabase(database)).rejects.toThrow('versión más reciente');
    expect(
      (await database.first<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    ).toBe(14);
  });

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

    // 2. Aplicar todas las migraciones (hasta v10)
    await migrateDatabase(database);
    const v7 = await database.first<{ user_version: number }>('PRAGMA user_version');
    expect(v7?.user_version).toBe(13);

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

  it('migración 007 incorpora interaccion_educativa_local y amplía descarga preservando datos previos', async () => {
    const database = open();
    // 1. Migrar hasta v6
    await migrateDatabase(database, [
      { version: 1, sql: REGISTROS_SQL },
      { version: 2, sql: CONTEXTO_SQL },
      { version: 3, sql: DESCARGAS_SQL },
      { version: 4, sql: FORMULARIOS_SQL },
      { version: 5, sql: CONTEXTO_CLINICO_SQL },
      { version: 6, sql: CONSENTIMIENTOS_SQL },
    ]);

    // Insertar paciente y descarga previa en v6
    await database.run(
      "INSERT INTO paciente_cache (paciente_id, nombre, email, rut, obtenido_en) VALUES (?, 'Paciente V6', 'v6@test.com', '1-9', '2026-10-01T00:00:00Z')",
      [patientA],
    );
    await database.run(
      `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, estado, fecha_descarga, visualizada)
       VALUES (?, 'edu-previo', '/data/prev.md', 'descargado', '2026-10-01T12:00:00Z', 1)`,
      [patientA],
    );

    // 2. Aplicar todas las migraciones (hasta v10)
    await migrateDatabase(database);
    const v = await database.first<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(13);

    // 3. Comprobar que la descarga previa conserva sus valores y tiene los nuevos defaults
    const prev = await database.first<{
      paciente_id: string;
      contenido_id: string;
      ruta_local: string;
      visualizada: number;
      revision_declarada: number;
      formato: string;
      tamano_bytes: number;
      metadata_local_json: string | null;
    }>('SELECT * FROM descarga WHERE contenido_id = ?', ['edu-previo']);

    expect(prev).not.toBeNull();
    expect(prev?.ruta_local).toBe('/data/prev.md');
    expect(prev?.visualizada).toBe(1);
    expect(prev?.revision_declarada).toBe(0);
    expect(prev?.formato).toBe('markdown');
    expect(prev?.tamano_bytes).toBe(0);
    expect(prev?.metadata_local_json).toBeNull();

    // 4. Comprobar que interaccion_educativa_local admite inserción válida
    await database.run(
      `INSERT INTO interaccion_educativa_local (
        paciente_id, contenido_id, youtube_video_id, version_origen, revision_declarada_en, creado_en, actualizado_en
      ) VALUES (?, 'edu-vid-1', 'abc12345678', '1.0.0', '2026-10-12T10:00:00Z', '2026-10-12T10:00:00Z', '2026-10-12T10:00:00Z')`,
      [patientA],
    );

    const inter = await database.first<{ contenido_id: string; youtube_video_id: string }>(
      'SELECT * FROM interaccion_educativa_local WHERE contenido_id = ?',
      ['edu-vid-1'],
    );
    expect(inter?.youtube_video_id).toBe('abc12345678');
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

  it('migración 008: valida integridad referencial, índices únicos y restricciones CHECK de recordatorios y avisos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Los medicamentos 'med-a-1' (pacienteA) y 'med-b-1' (pacienteB) ya están sembrados por seedPatientContextIfEmpty.
    // 2. Inserción válida de regla de vitales y regla de medicación
    await database.run(
      `INSERT INTO recordatorio_local (
        id, paciente_id, tipo, medicamento_id, dias_semana, horas_minutos, zona_horaria, fecha_inicio, fecha_fin, habilitado, revision, creado_el, actualizado_el
      ) VALUES (?, ?, 'registro_vitales', NULL, '[1,2,3,4,5,6,7]', '["09:00"]', 'America/Santiago', NULL, NULL, 1, 1, '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
      ['rule-vital-a', patientA],
    );

    await database.run(
      `INSERT INTO recordatorio_local (
        id, paciente_id, tipo, medicamento_id, dias_semana, horas_minutos, zona_horaria, fecha_inicio, fecha_fin, habilitado, revision, creado_el, actualizado_el
      ) VALUES (?, ?, 'medicacion', 'med-a-1', '[1,3,5]', '["10:00"]', 'America/Santiago', '2026-10-01', '2026-12-31', 1, 1, '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
      ['rule-med-a', patientA],
    );

    // 3. Inserción válida de notificación referenciando (paciente_id, recordatorio_id)
    await database.run(
      `INSERT INTO notificacion_local (
        id, paciente_id, recordatorio_id, revision, tipo, fecha_prevista_utc, id_nativo, estado, payload_minimo, creado_el, actualizado_el
      ) VALUES (?, ?, 'rule-med-a', 1, 'medicacion', '2026-10-14T13:00:00Z', 'notif-native-1', 'programada', '{}', '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
      ['job-1', patientA],
    );

    // 4. Comprobación de PRAGMA foreign_key_check limpio
    const fkErrors = await database.all<{
      table: string;
      rowid: number;
      parent: string;
      fkid: number;
    }>('PRAGMA foreign_key_check');
    expect(fkErrors).toEqual([]);

    // 5. Rechazo de vinculación de regla de A con medicamento de B (FK compuesta)
    await expect(
      database.run(
        `INSERT INTO recordatorio_local (
          id, paciente_id, tipo, medicamento_id, dias_semana, horas_minutos, zona_horaria, creado_el, actualizado_el
        ) VALUES (?, ?, 'medicacion', 'med-b-1', '[1]', '["08:00"]', 'America/Santiago', '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
        ['rule-cross-med', patientA],
      ),
    ).rejects.toThrow();

    // 6. Rechazo de vinculación de notificación de B con regla de A (FK compuesta)
    await expect(
      database.run(
        `INSERT INTO notificacion_local (
          id, paciente_id, recordatorio_id, revision, tipo, fecha_prevista_utc, estado, payload_minimo, creado_el, actualizado_el
        ) VALUES (?, ?, 'rule-med-a', 1, 'medicacion', '2026-10-14T14:00:00Z', 'pendiente', '{}', '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
        ['job-cross-patient', patientB],
      ),
    ).rejects.toThrow();

    // 7. Rechazo de restricción CHECK de tipo: medicación sin medicamento
    await expect(
      database.run(
        `INSERT INTO recordatorio_local (
          id, paciente_id, tipo, medicamento_id, dias_semana, horas_minutos, zona_horaria, creado_el, actualizado_el
        ) VALUES (?, ?, 'medicacion', NULL, '[1]', '["08:00"]', 'America/Santiago', '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
        ['rule-invalid-med', patientA],
      ),
    ).rejects.toThrow();

    // 8. Rechazo de restricción CHECK de tipo: vitales con medicamento
    await expect(
      database.run(
        `INSERT INTO recordatorio_local (
          id, paciente_id, tipo, medicamento_id, dias_semana, horas_minutos, zona_horaria, creado_el, actualizado_el
        ) VALUES (?, ?, 'registro_vitales', 'med-a-1', '[1]', '["08:00"]', 'America/Santiago', '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
        ['rule-invalid-vit', patientA],
      ),
    ).rejects.toThrow();

    // 9. Rechazo de fechas invertidas: fecha_inicio > fecha_fin
    await expect(
      database.run(
        `INSERT INTO recordatorio_local (
          id, paciente_id, tipo, medicamento_id, dias_semana, horas_minutos, zona_horaria, fecha_inicio, fecha_fin, creado_el, actualizado_el
        ) VALUES (?, ?, 'registro_vitales', NULL, '[1]', '["08:00"]', 'America/Santiago', '2026-12-31', '2026-01-01', '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
        ['rule-invalid-dates', patientA],
      ),
    ).rejects.toThrow();

    // 10. Rechazo de duplicado lógico en notificacion_local (UNIQUE paciente_id, recordatorio_id, revision, fecha_prevista_utc)
    await expect(
      database.run(
        `INSERT INTO notificacion_local (
          id, paciente_id, recordatorio_id, revision, tipo, fecha_prevista_utc, id_nativo, estado, payload_minimo, creado_el, actualizado_el
        ) VALUES (?, ?, 'rule-med-a', 1, 'medicacion', '2026-10-14T13:00:00Z', 'notif-native-2', 'programada', '{}', '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')`,
        ['job-duplicate', patientA],
      ),
    ).rejects.toThrow();
  });

  it('migración 009: reconstruye borrador_formulario con periodo_clave y añade columnas temporales a respuesta_formulario', async () => {
    const database = open();

    // 1. Migrar hasta v8
    const { migrations } = await import('./migrations');
    const v1To8 = migrations.filter((m) => m.version <= 8);
    await migrateDatabase(database, v1To8);

    // 2. Sembrar datos previos en v8
    await database.run(
      `INSERT INTO paciente_cache (paciente_id, nombre, rut, obtenido_en)
       VALUES (?, 'Paciente Demo', '12.345.678-9', '2026-10-18T10:00:00Z')`,
      [patientA],
    );

    await database.run(
      `INSERT INTO formulario_cache (formulario_id, version, titulo, descripcion, obtenido_en)
       VALUES ('form-test', '1.0.0', 'Formulario Test', 'Desc', '2026-10-18T10:00:00Z')`,
    );

    await database.run(
      `INSERT INTO borrador_formulario (paciente_id, formulario_id, version, entrega_id, respuestas_json, guardado_en, version_payload)
       VALUES (?, 'form-test', '1.0.0', 'draft-uuid-legacy-123', '{"P1":"si"}', '2026-10-17T20:00:00Z', 1)`,
      [patientA],
    );

    await database.run(
      `INSERT INTO respuesta_formulario (id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en)
       VALUES ('resp-prev-1', ?, 'form-test', '1.0.0', '{"P1":"si"}', '2026-10-16T15:00:00Z', '2026-10-16T15:00:00Z')`,
      [patientA],
    );

    // 3. Aplicar migración 009
    await migrateDatabase(database);

    const versionRow = await database.first<{ user_version: number }>('PRAGMA user_version');
    expect(versionRow?.user_version).toBe(13);

    // 4. Verificar integridad referencial completa
    const fkErrors = await database.all('PRAGMA foreign_key_check');
    expect(fkErrors).toEqual([]);

    // 5. Verificar que el borrador migró a periodo_clave = 'legacy' conservando sus datos
    const legacyDraft = await database.first<{
      paciente_id: string;
      formulario_id: string;
      version: string;
      periodo_clave: string;
      entrega_id: string;
      respuestas_json: string;
      guardado_en: string;
      version_payload: number;
      fecha_seguimiento: string | null;
      paso_actual: string | null;
    }>(
      'SELECT * FROM borrador_formulario WHERE paciente_id = ? AND formulario_id = ? AND version = ?',
      [patientA, 'form-test', '1.0.0'],
    );

    expect(legacyDraft).not.toBeNull();
    expect(legacyDraft?.periodo_clave).toBe('legacy');
    expect(legacyDraft?.entrega_id).toBe('draft-uuid-legacy-123');
    expect(legacyDraft?.respuestas_json).toBe('{"P1":"si"}');
    expect(legacyDraft?.version_payload).toBe(1);

    // 6. Verificar que se puede insertar un borrador diario para el mismo formulario sin conflicto
    await database.run(
      `INSERT INTO borrador_formulario (
        paciente_id, formulario_id, version, periodo_clave,
        fecha_seguimiento, zona_horaria, iniciado_en, ventana_desde, ventana_hasta, paso_actual,
        entrega_id, respuestas_json, guardado_en, version_payload
      ) VALUES (?, 'form-test', '1.0.0', 'dia:2026-10-18', '2026-10-18', 'America/Santiago', '2026-10-18T12:00:00Z', '2026-10-18T00:00:00-03:00', '2026-10-18T23:59:59-03:00', 'sec-general', 'draft-uuid-daily-456', '{"P1":"no"}', '2026-10-18T12:05:00Z', 2)`,
      [patientA],
    );

    const allDrafts = await database.all<{ periodo_clave: string }>(
      'SELECT periodo_clave FROM borrador_formulario WHERE paciente_id = ? ORDER BY periodo_clave ASC',
      [patientA],
    );
    expect(allDrafts.map((d) => d.periodo_clave)).toEqual(['dia:2026-10-18', 'legacy']);

    // 7. Verificar columnas nuevas en respuesta_formulario
    const updatedResp = await database.first<{
      id: string;
      fecha_seguimiento: string | null;
      zona_horaria: string | null;
    }>('SELECT id, fecha_seguimiento, zona_horaria FROM respuesta_formulario WHERE id = ?', [
      'resp-prev-1',
    ]);
    expect(updatedResp).not.toBeNull();
    expect(updatedResp?.fecha_seguimiento).toBeNull();

    // Actualizar con metadatos diarios
    await database.run(
      `UPDATE respuesta_formulario
       SET fecha_seguimiento = '2026-10-16', zona_horaria = 'America/Santiago'
       WHERE id = ?`,
      ['resp-prev-1'],
    );
    const reloadedResp = await database.first<{ fecha_seguimiento: string }>(
      'SELECT fecha_seguimiento FROM respuesta_formulario WHERE id = ?',
      ['resp-prev-1'],
    );
    expect(reloadedResp?.fecha_seguimiento).toBe('2026-10-16');
  });

  it('aplica migración 010 marcando descargas markdown como retiradas y aplicando restricciones de formato', async () => {
    const database = open();

    // 1. Aplicar migraciones hasta v9
    const { migrations } = await import('./migrations');
    const v9Migrations = migrations.filter((m) => m.version <= 9);
    await migrateDatabase(database, v9Migrations);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 2. Insertar descarga previa en formato markdown (v9 tenía formato DEFAULT 'markdown')
    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga, visualizada, visualizada_en,
        revision_declarada, revision_declarada_en, formato, tamano_bytes, metadata_local_json
      ) VALUES (
        ?, 'edu-guia-legacy', '/data/user/0/recursos/edu-guia-legacy.md', 'descargado', '2026-10-10T10:00:00Z',
        1, '2026-10-10T10:05:00Z', 1, '2026-10-10T10:05:00Z', 'markdown', 2048, '{"titulo":"Guía previa","versionOrigen":"1.0"}'
      )`,
      [patientA],
    );

    // Insertar también una descarga previa en formato png
    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga, visualizada, visualizada_en,
        revision_declarada, revision_declarada_en, formato, tamano_bytes, metadata_local_json
      ) VALUES (
        ?, 'edu-info-existente', '/data/user/0/recursos/edu-info-existente.png', 'descargado', '2026-10-10T11:00:00Z',
        0, NULL, 0, NULL, 'png', 409600, '{"titulo":"Infografía previa","versionOrigen":"1.0"}'
      )`,
      [patientA],
    );

    // 3. Aplicar migración 010 (todas las migraciones disponibles)
    await migrateDatabase(database);

    const versionRow = await database.first<{ user_version: number }>('PRAGMA user_version');
    expect(versionRow?.user_version).toBe(13);

    // 4. Verificar integridad referencial
    const fkErrors = await database.all('PRAGMA foreign_key_check');
    expect(fkErrors).toEqual([]);

    // 5. Verificar que la fila markdown quedó marcada como retirada con su ruta y datos preservados
    const retiredRow = await database.first<{
      paciente_id: string;
      contenido_id: string;
      ruta_local: string;
      estado: string;
      formato: string;
      retirado_en: string | null;
      ultimo_error_retiro: string | null;
      metadata_local_json: string;
    }>('SELECT * FROM descarga WHERE paciente_id = ? AND contenido_id = ?', [
      patientA,
      'edu-guia-legacy',
    ]);

    expect(retiredRow).not.toBeNull();
    expect(retiredRow?.formato).toBe('markdown');
    expect(retiredRow?.retirado_en).toBeTruthy();
    expect(retiredRow?.ultimo_error_retiro).toBeNull();
    expect(retiredRow?.ruta_local).toBe('/data/user/0/recursos/edu-guia-legacy.md');
    expect(retiredRow?.metadata_local_json).toContain('Guía previa');

    // 6. Verificar que la fila png conservó retirado_en en NULL (activa)
    const activeRow = await database.first<{
      formato: string;
      retirado_en: string | null;
    }>('SELECT formato, retirado_en FROM descarga WHERE paciente_id = ? AND contenido_id = ?', [
      patientA,
      'edu-info-existente',
    ]);
    expect(activeRow?.formato).toBe('png');
    expect(activeRow?.retirado_en).toBeNull();

    // 7. Intentar insertar una nueva fila markdown activa (sin retirado_en) debe violar la restricción CHECK
    await expect(
      database.run(
        `INSERT INTO descarga (
          paciente_id, contenido_id, ruta_local, estado, fecha_descarga, formato, retirado_en
        ) VALUES (?, 'edu-nuevo-md', '/data/test.md', 'descargado', '2026-10-18T10:00:00Z', 'markdown', NULL)`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 8. Se pueden insertar copias activas en jpeg o png
    await database.run(
      `INSERT INTO descarga (
        paciente_id, contenido_id, ruta_local, estado, fecha_descarga, formato
      ) VALUES (?, 'edu-nuevo-jpeg', '/data/test.jpg', 'descargado', '2026-10-18T10:00:00Z', 'jpeg')`,
      [patientA],
    );
    const jpegRow = await database.first<{ formato: string; retirado_en: string | null }>(
      'SELECT formato, retirado_en FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
      [patientA, 'edu-nuevo-jpeg'],
    );
    expect(jpegRow?.formato).toBe('jpeg');
    expect(jpegRow?.retirado_en).toBeNull();
  });
});
