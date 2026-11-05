import { describe, expect, it, afterEach } from 'vitest';
import { createSqliteTestHarness } from '../local/testing/sqlite-test-harness';
import { migrateDatabase } from '../local/migrations';
import { pruneSynchronizedRecords } from './local-retention';

const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());

const patientId = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';

async function setupDatabase() {
  const db = harness.open();
  await migrateDatabase(db);
  await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
    patientId,
    'Paciente Prueba',
    new Date().toISOString(),
  ]);
  return db;
}

describe('pruneSynchronizedRecords local retention policy', () => {
  it('purga los signos vitales antiguos cuando se superan las 5 capturas sincronizadas', async () => {
    const db = await setupDatabase();

    // Insertar 10 signos vitales sincronizados en orden cronológico
    for (let i = 1; i <= 10; i++) {
      const id = `signo-${String(i).padStart(2, '0')}`;
      const time = `2026-11-04T10:${String(i).padStart(2, '0')}:00Z`;
      await db.run(
        `INSERT INTO signos_vitales(id, paciente_id, fecha_registro, presion_sistolica, presion_diastolica, pulso, creado_localmente_en, fecha_subida)
         VALUES (?, ?, ?, 120, 80, 70, ?, ?)`,
        [id, patientId, time, time, time],
      );
      await db.run(
        `INSERT INTO qc_clinical_command(id, owner, environment, kind, status, captured_at, payload_json, updated_at, ack_json)
         VALUES (?, ?, 'demo', 'signos', 'aceptado', ?, '{}', ?, '{}')`,
        [id, owner, time, time],
      );
    }

    const initialCount = (
      await db.all<{ count: number }>(
        'SELECT count(*) as count FROM signos_vitales WHERE paciente_id = ?',
        [patientId],
      )
    )[0]?.count;
    expect(initialCount).toBe(10);

    // Ejecutar purga de retención (conservar 5)
    const deleted = await pruneSynchronizedRecords(db, patientId, owner, 'signos', {
      retainCount: 5,
    });
    expect(deleted).toBe(5);

    // Verificar que quedan exactamente 5 registros
    const remaining = await db.all<{ id: string; fecha_registro: string }>(
      'SELECT id, fecha_registro FROM signos_vitales WHERE paciente_id = ? ORDER BY fecha_registro ASC',
      [patientId],
    );
    expect(remaining).toHaveLength(5);

    // Los que deben quedar son los 5 más recientes (del 06 al 10)
    expect(remaining.map((r) => r.id)).toEqual([
      'signo-06',
      'signo-07',
      'signo-08',
      'signo-09',
      'signo-10',
    ]);
  });

  it('REGLA DE ORO: NUNCA purga signos vitales pendientes de sincronización (fecha_subida IS NULL)', async () => {
    const db = await setupDatabase();

    // 5 sincronizados y 5 pendientes de subida
    for (let i = 1; i <= 5; i++) {
      const id = `sincronizado-${i}`;
      const time = `2026-11-04T08:0${i}:00Z`;
      await db.run(
        `INSERT INTO signos_vitales(id, paciente_id, fecha_registro, presion_sistolica, pulso, creado_localmente_en, fecha_subida)
         VALUES (?, ?, ?, 120, 70, ?, ?)`,
        [id, patientId, time, time, time],
      );
    }
    for (let i = 6; i <= 10; i++) {
      const id = `pendiente-${i}`;
      const time = `2026-11-04T09:0${i}:00Z`;
      await db.run(
        `INSERT INTO signos_vitales(id, paciente_id, fecha_registro, presion_sistolica, pulso, creado_localmente_en, fecha_subida)
         VALUES (?, ?, ?, 120, 70, ?, NULL)`,
        [id, patientId, time, time],
      );
    }

    // Hay 10 registros en total, pero solo 5 están sincronizados
    const deleted = await pruneSynchronizedRecords(db, patientId, owner, 'signos', {
      retainCount: 5,
    });
    expect(deleted).toBe(0);

    const pendingRemaining = await db.all<{ id: string }>(
      'SELECT id FROM signos_vitales WHERE paciente_id = ? AND fecha_subida IS NULL',
      [patientId],
    );
    expect(pendingRemaining).toHaveLength(5);
  });

  it('purga respuestas de formulario (EPRO) antiguas aceptadas y preserva las pendientes', async () => {
    const db = await setupDatabase();
    const formId = 'formulario-demo-1';
    await db.run(
      `INSERT INTO formulario_cache(formulario_id, version, titulo, descripcion, configuracion_json, obtenido_en)
       VALUES (?, '1', 'Seguimiento', 'Descripción', '{}', ?)`,
      [formId, new Date().toISOString()],
    );

    // Insertar 8 respuestas aceptadas en el servidor
    for (let i = 1; i <= 8; i++) {
      const id = `epro-${String(i).padStart(2, '0')}`;
      const time = `2026-11-04T12:${String(i).padStart(2, '0')}:00Z`;
      await db.run(
        `INSERT INTO respuesta_formulario(id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en)
         VALUES (?, ?, ?, '1', '{}', ?, ?)`,
        [id, patientId, formId, time, time],
      );
      await db.run(
        `INSERT INTO qc_clinical_command(id, owner, environment, kind, status, captured_at, payload_json, updated_at, ack_json)
         VALUES (?, ?, 'demo', 'epro', 'aceptado', ?, '{}', ?, '{}')`,
        [id, owner, time, time],
      );
    }

    // Insertar 2 respuestas pendientes de subida (status = 'pendiente')
    for (let i = 9; i <= 10; i++) {
      const id = `epro-pendiente-${i}`;
      const time = `2026-11-04T13:0${i}:00Z`;
      await db.run(
        `INSERT INTO respuesta_formulario(id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en)
         VALUES (?, ?, ?, '1', '{}', ?, ?)`,
        [id, patientId, formId, time, time],
      );
      await db.run(
        `INSERT INTO qc_clinical_command(id, owner, environment, kind, status, captured_at, payload_json, updated_at)
         VALUES (?, ?, 'demo', 'epro', 'pendiente', ?, '{}', ?)`,
        [id, owner, time, time],
      );
    }

    // Hay 8 sincronizadas y 2 pendientes (total 10). Se deben purgar 3 de las sincronizadas (8 - 5 = 3).
    const deleted = await pruneSynchronizedRecords(db, patientId, owner, 'epro', {
      retainCount: 5,
    });
    expect(deleted).toBe(3);

    const remainingAceptadas = await db.all<{ id: string }>(
      `SELECT rf.id FROM respuesta_formulario rf
       INNER JOIN qc_clinical_command cmd ON cmd.id = rf.id
       WHERE rf.paciente_id = ? AND cmd.status = 'aceptado'`,
      [patientId],
    );
    expect(remainingAceptadas).toHaveLength(5);

    // Las 2 pendientes NUNCA deben haber sido eliminadas
    const remainingPendientes = await db.all<{ id: string }>(
      `SELECT rf.id FROM respuesta_formulario rf
       INNER JOIN qc_clinical_command cmd ON cmd.id = rf.id
       WHERE rf.paciente_id = ? AND cmd.status = 'pendiente'`,
      [patientId],
    );
    expect(remainingPendientes).toHaveLength(2);
  });
});
