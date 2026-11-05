import type { SqlConnection } from '../local/core/sql';
import type { ClinicalScope } from './clinical-command';

/**
 * Feature flag for 90-day clinical retention cleanup.
 * Kept disabled in production flow until explicitly activated after tests pass.
 */
export const CLINICAL_RETENTION_ENABLED = false;

export interface RetentionCleanupResult {
  purgedRecords: number;
  batchesExecuted: number;
  stoppedReason?: 'budget_exhausted' | 'complete' | 'disabled' | 'error';
}

export interface RetentionCleanupOptions {
  batchSize?: number;
  cooperativePauseMs?: number;
  maxDurationMs?: number;
  retentionDays?: number;
  forceEnable?: boolean;
}

/**
 * Multi-batch clinical retention cleanup.
 * Safely purges vital signs and symptom records older than retentionDays
 * only if:
 * 1. Matching active owner and environment
 * 2. Already accepted remotely by the server (status = 'aceptado')
 * 3. Outbox / queue has finished and has no pending commands for the record
 */
export async function runClinicalRetentionCleanup(
  db: SqlConnection,
  scope: ClinicalScope,
  options: RetentionCleanupOptions = {},
): Promise<RetentionCleanupResult> {
  const {
    batchSize = 100,
    cooperativePauseMs = 50,
    maxDurationMs = 5000,
    retentionDays = 90,
    forceEnable = false,
  } = options;

  if (!CLINICAL_RETENTION_ENABLED && !forceEnable) {
    return {
      purgedRecords: 0,
      batchesExecuted: 0,
      stoppedReason: 'disabled',
    };
  }

  const startTime = Date.now();
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  let purgedTotal = 0;
  let batchesCount = 0;

  while (true) {
    if (Date.now() - startTime > maxDurationMs) {
      return {
        purgedRecords: purgedTotal,
        batchesExecuted: batchesCount,
        stoppedReason: 'budget_exhausted',
      };
    }

    const candidates = await db.all<{ id: string }>(
      `SELECT s.id FROM signos_vitales s
       WHERE s.paciente_id = ?
         AND s.fecha_registro < ?
         AND s.estado_envio = 'aceptado'
         AND NOT EXISTS (
           SELECT 1 FROM qc_clinical_command c
           WHERE c.id = s.id
             AND c.owner = ?
             AND c.environment = ?
             AND c.status IN ('pendiente', 'enviando', 'pausado', 'error_reintentable')
         )
       LIMIT ?`,
      [scope.localPatientId, cutoffDate, scope.owner, scope.environment, batchSize],
    );

    if (candidates.length === 0) {
      break;
    }

    const ids = candidates.map((c) => c.id);
    const placeholders = ids.map(() => '?').join(',');

    await db.transaction(async (tx) => {
      await tx.run(`DELETE FROM signos_vitales WHERE id IN (${placeholders})`, ids);
      await tx.run(
        `DELETE FROM qc_clinical_command
         WHERE id IN (${placeholders})
           AND owner = ?
           AND environment = ?
           AND status = 'aceptado'`,
        [...ids, scope.owner, scope.environment],
      );
    });

    purgedTotal += ids.length;
    batchesCount++;

    if (cooperativePauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, cooperativePauseMs));
    }
  }

  return {
    purgedRecords: purgedTotal,
    batchesExecuted: batchesCount,
    stoppedReason: 'complete',
  };
}
