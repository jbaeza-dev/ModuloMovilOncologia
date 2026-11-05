import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteTestHarness } from '../local/testing/sqlite-test-harness';
import { runClinicalRetentionCleanup, CLINICAL_RETENTION_ENABLED } from './clinical-retention';

const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());

describe('Retención clínica condicionada (90 días)', () => {
  const scope = {
    owner: 'user-1',
    localPatientId: 'patient-1',
    environment: 'demo',
  };

  async function setupSchema(db: ReturnType<typeof harness.open>) {
    await db.exec(`
      CREATE TABLE signos_vitales (
        id TEXT PRIMARY KEY,
        paciente_id TEXT NOT NULL,
        fecha_registro TEXT NOT NULL,
        estado_envio TEXT NOT NULL
      );
      CREATE TABLE qc_clinical_command (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        environment TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
  }

  it('permanece desactivada por defecto en producción', async () => {
    expect(CLINICAL_RETENTION_ENABLED).toBe(false);
    const db = harness.open();
    await setupSchema(db);

    const result = await runClinicalRetentionCleanup(db, scope);
    expect(result.purgedRecords).toBe(0);
    expect(result.stoppedReason).toBe('disabled');
  });

  it('conserva registros menores a 90 días y registros pendientes/pausados', async () => {
    const db = harness.open();
    await setupSchema(db);

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const oldDate = new Date(now - 120 * dayMs).toISOString();
    const recentDate = new Date(now - 30 * dayMs).toISOString();

    // 1. Antiguo pero pendiente -> debe conservarse
    await db.run('INSERT INTO signos_vitales VALUES (?, ?, ?, ?)', [
      'v-old-pending',
      scope.localPatientId,
      oldDate,
      'pendiente',
    ]);
    await db.run('INSERT INTO qc_clinical_command VALUES (?, ?, ?, ?)', [
      'v-old-pending',
      scope.owner,
      scope.environment,
      'pendiente',
    ]);

    // 2. Antiguo pero pausado -> debe conservarse
    await db.run('INSERT INTO signos_vitales VALUES (?, ?, ?, ?)', [
      'v-old-paused',
      scope.localPatientId,
      oldDate,
      'pausado',
    ]);

    // 3. Reciente y aceptado -> debe conservarse (menor a 90 días)
    await db.run('INSERT INTO signos_vitales VALUES (?, ?, ?, ?)', [
      'v-recent-accepted',
      scope.localPatientId,
      recentDate,
      'aceptado',
    ]);

    // 4. Antiguo y aceptado pero de OTRO paciente -> debe conservarse
    await db.run('INSERT INTO signos_vitales VALUES (?, ?, ?, ?)', [
      'v-other-patient',
      'patient-2',
      oldDate,
      'aceptado',
    ]);

    // 5. Antiguo, aceptado, del paciente actual, sin comandos pendientes -> DEBE purgarse
    await db.run('INSERT INTO signos_vitales VALUES (?, ?, ?, ?)', [
      'v-old-accepted-1',
      scope.localPatientId,
      oldDate,
      'aceptado',
    ]);
    await db.run('INSERT INTO qc_clinical_command VALUES (?, ?, ?, ?)', [
      'v-old-accepted-1',
      scope.owner,
      scope.environment,
      'aceptado',
    ]);

    const result = await runClinicalRetentionCleanup(db, scope, { forceEnable: true });

    expect(result.purgedRecords).toBe(1);
    expect(result.batchesExecuted).toBe(1);
    expect(result.stoppedReason).toBe('complete');

    const remaining = await db.all<{ id: string }>('SELECT id FROM signos_vitales ORDER BY id');
    expect(remaining.map((r) => r.id)).toEqual([
      'v-old-paused',
      'v-old-pending',
      'v-other-patient',
      'v-recent-accepted',
    ]);

    // El comando de la purgada debe eliminarse
    const remainingCommands = await db.all<{ id: string }>('SELECT id FROM qc_clinical_command');
    expect(remainingCommands.map((r) => r.id)).toEqual(['v-old-pending']);
  });

  it('ejecuta en lotes respetando el límite por lote', async () => {
    const db = harness.open();
    await setupSchema(db);

    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

    for (let i = 1; i <= 25; i++) {
      await db.run('INSERT INTO signos_vitales VALUES (?, ?, ?, ?)', [
        `vital-${i}`,
        scope.localPatientId,
        oldDate,
        'aceptado',
      ]);
    }

    const result = await runClinicalRetentionCleanup(db, scope, {
      forceEnable: true,
      batchSize: 10,
      cooperativePauseMs: 0,
    });

    expect(result.purgedRecords).toBe(25);
    expect(result.batchesExecuted).toBe(3); // 10 + 10 + 5
    expect(result.stoppedReason).toBe('complete');

    const count = await db.first<{ total: number }>('SELECT count(*) as total FROM signos_vitales');
    expect(count?.total).toBe(0);
  });
});
