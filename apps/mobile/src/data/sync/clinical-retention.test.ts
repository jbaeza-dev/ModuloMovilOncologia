import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteTestHarness } from '../local/testing/sqlite-test-harness';
import { migrateDatabase } from '../local/migrations';
import { runClinicalRetentionCleanup, CLINICAL_RETENTION_ENABLED } from './clinical-retention';

const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());

describe('Retención clínica condicionada con migraciones reales (90 días)', () => {
  const scope = {
    owner: 'user-1',
    localPatientId: 'patient-1',
    environment: 'demo',
  };

  async function setupRealDb() {
    const db = harness.open();
    await migrateDatabase(db);
    await db.run(
      'INSERT OR IGNORE INTO paciente_cache (paciente_id, nombre, obtenido_en) VALUES (?, ?, ?)',
      [scope.localPatientId, 'Paciente Prueba', new Date().toISOString()],
    );
    return db;
  }

  it('permanece desactivada por defecto en producción', async () => {
    expect(CLINICAL_RETENTION_ENABLED).toBe(false);
    const db = await setupRealDb();

    const result = await runClinicalRetentionCleanup(db, scope);
    expect(result.purgedRecords).toBe(0);
    expect(result.stoppedReason).toBe('disabled');
  });

  it('con migraciones reales, purga signos vitales y formularios aceptados con ACK mayor a 90 días', async () => {
    const db = await setupRealDb();

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const oldDate = new Date(now - 120 * dayMs).toISOString();
    const recentDate = new Date(now - 30 * dayMs).toISOString();

    // 1. Signos vitales: Antiguo y aceptado con ACK -> DEBE purgarse
    await db.run(
      `INSERT INTO signos_vitales (
        id, paciente_id, fecha_registro, temperatura, creado_localmente_en
      ) VALUES (?, ?, ?, ?, ?)`,
      ['v-old-accepted', scope.localPatientId, oldDate, 36.5, oldDate],
    );
    await db.run(
      `INSERT INTO qc_clinical_command (
        id, owner, environment, kind, captured_at, payload_json, status, ack_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'v-old-accepted',
        scope.owner,
        scope.environment,
        'signos',
        oldDate,
        '{}',
        'aceptado',
        '{"received":true}',
        oldDate,
      ],
    );

    await db.run(
      `INSERT INTO formulario_cache (
        formulario_id, version, titulo, descripcion, obtenido_en
      ) VALUES (?, ?, ?, ?, ?)`,
      ['form-1', '1.0', 'Formulario Test', 'Desc', oldDate],
    );

    // 2. Respuesta formulario: Antigua y aceptada con ACK -> DEBE purgarse
    await db.run(
      `INSERT INTO respuesta_formulario (
        id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['f-old-accepted', scope.localPatientId, 'form-1', '1.0', '{}', oldDate, oldDate],
    );
    await db.run(
      `INSERT INTO qc_clinical_command (
        id, owner, environment, kind, captured_at, payload_json, status, ack_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'f-old-accepted',
        scope.owner,
        scope.environment,
        'epro',
        oldDate,
        '{}',
        'aceptado',
        '{"received":true}',
        oldDate,
      ],
    );

    // 3. Signos vitales: Reciente (< 90 días) y aceptado -> DEBE conservarse
    await db.run(
      `INSERT INTO signos_vitales (
        id, paciente_id, fecha_registro, temperatura, creado_localmente_en
      ) VALUES (?, ?, ?, ?, ?)`,
      ['v-recent-accepted', scope.localPatientId, recentDate, 36.6, recentDate],
    );
    await db.run(
      `INSERT INTO qc_clinical_command (
        id, owner, environment, kind, captured_at, payload_json, status, ack_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'v-recent-accepted',
        scope.owner,
        scope.environment,
        'signos',
        recentDate,
        '{}',
        'aceptado',
        '{"received":true}',
        recentDate,
      ],
    );

    // 4. Signos vitales: Antiguo pero con comando pendiente -> DEBE conservarse
    await db.run(
      `INSERT INTO signos_vitales (
        id, paciente_id, fecha_registro, temperatura, creado_localmente_en
      ) VALUES (?, ?, ?, ?, ?)`,
      ['v-old-pending', scope.localPatientId, oldDate, 37.0, oldDate],
    );
    await db.run(
      `INSERT INTO qc_clinical_command (
        id, owner, environment, kind, captured_at, payload_json, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'v-old-pending',
        scope.owner,
        scope.environment,
        'signos',
        oldDate,
        '{}',
        'pendiente',
        oldDate,
      ],
    );

    const result = await runClinicalRetentionCleanup(db, scope, { forceEnable: true });

    expect(result.purgedRecords).toBe(2);
    expect(result.batchesExecuted).toBeGreaterThanOrEqual(1);

    // Verificación de registros conservados
    const remainingVitals = await db.all<{ id: string }>(
      'SELECT id FROM signos_vitales ORDER BY id',
    );
    expect(remainingVitals.map((v) => v.id)).toEqual(['v-old-pending', 'v-recent-accepted']);

    const remainingForms = await db.all<{ id: string }>(
      'SELECT id FROM respuesta_formulario ORDER BY id',
    );
    expect(remainingForms).toEqual([]);
  });

  it('no purga ningún registro si la cola del SDK (qc_gateway_outbox) tiene eventos pendientes', async () => {
    const db = await setupRealDb();

    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      `INSERT INTO signos_vitales (
        id, paciente_id, fecha_registro, temperatura, creado_localmente_en
      ) VALUES (?, ?, ?, ?, ?)`,
      ['v-old-with-pending-outbox', scope.localPatientId, oldDate, 36.5, oldDate],
    );
    await db.run(
      `INSERT INTO qc_clinical_command (
        id, owner, environment, kind, captured_at, payload_json, status, ack_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'v-old-with-pending-outbox',
        scope.owner,
        scope.environment,
        'signos',
        oldDate,
        '{}',
        'aceptado',
        '{"received":true}',
        oldDate,
      ],
    );

    // Evento pendiente en el outbox del gateway
    await db.run(
      `INSERT INTO qc_gateway_outbox (
        id, owner, environment, kind, body_json, created_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['evt-1', scope.owner, scope.environment, 'receipt', '{}', oldDate, 'pending'],
    );

    const result = await runClinicalRetentionCleanup(db, scope, { forceEnable: true });

    expect(result.purgedRecords).toBe(0);
    expect(result.stoppedReason).toBe('outbox_pending');

    const vitals = await db.all<{ id: string }>('SELECT id FROM signos_vitales');
    expect(vitals.length).toBe(1);
  });
});
