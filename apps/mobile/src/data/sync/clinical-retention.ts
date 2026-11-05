import type { SqlConnection } from '../local/core/sql';
import type { ClinicalScope } from './clinical-command';

/**
 * Feature flag de retención clínica (ventana de 90 días).
 * Implementación preliminar mantenida desactivada por defecto
 * hasta su formalización y pruebas de aceptación en hardware.
 */
export const CLINICAL_RETENTION_ENABLED = false;

export interface RetentionCleanupResult {
  purgedRecords: number;
  batchesExecuted: number;
  stoppedReason?: 'budget_exhausted' | 'complete' | 'disabled' | 'outbox_pending' | 'error';
}

export interface RetentionCleanupOptions {
  batchSize?: number;
  cooperativePauseMs?: number;
  maxDurationMs?: number;
  retentionDays?: number;
  forceEnable?: boolean;
}

export async function runClinicalRetentionCleanup(
  db: SqlConnection,
  scope: ClinicalScope,
  options: RetentionCleanupOptions = {},
): Promise<RetentionCleanupResult> {
  const {
    batchSize = 100,
    cooperativePauseMs = 50,
    maxDurationMs = 2000,
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

  const outboxCheck = await db.first<{ pending: number }>(
    "SELECT count(*) as pending FROM qc_gateway_outbox WHERE status = 'pending'",
  );
  if (outboxCheck && outboxCheck.pending > 0) {
    return {
      purgedRecords: 0,
      batchesExecuted: 0,
      stoppedReason: 'outbox_pending',
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

    const vitalCandidates = await db.all<{ id: string }>(
      `SELECT s.id FROM signos_vitales s
       WHERE s.paciente_id = ?
         AND s.fecha_registro < ?
         AND (
           EXISTS (
             SELECT 1 FROM qc_clinical_command c
             WHERE c.id = s.id
               AND c.owner = ?
               AND c.environment = ?
               AND c.status = 'aceptado'
               AND c.ack_json IS NOT NULL
           )
           OR (s.fecha_subida IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM qc_clinical_command c WHERE c.id = s.id
           ))
         )
         AND NOT EXISTS (
           SELECT 1 FROM qc_clinical_command c
           WHERE c.id = s.id
             AND c.status IN ('pendiente', 'pausado', 'rechazado')
         )
         AND NOT EXISTS (
           SELECT 1 FROM cola_envio q
           WHERE q.registro_id = s.id
             AND q.estado <> 'enviado'
         )
       LIMIT ?`,
      [scope.localPatientId, cutoffDate, scope.owner, scope.environment, batchSize],
    );

    const remainingQuota = batchSize - vitalCandidates.length;
    const formCandidates =
      remainingQuota > 0
        ? await db.all<{ id: string }>(
            `SELECT r.id FROM respuesta_formulario r
             WHERE r.paciente_id = ?
               AND r.fecha_confirmacion < ?
               AND EXISTS (
                 SELECT 1 FROM qc_clinical_command c
                 WHERE c.id = r.id
                   AND c.owner = ?
                   AND c.environment = ?
                   AND c.status = 'aceptado'
                   AND c.ack_json IS NOT NULL
               )
               AND NOT EXISTS (
                 SELECT 1 FROM qc_clinical_command c
                 WHERE c.id = r.id
                   AND c.status IN ('pendiente', 'pausado', 'rechazado')
               )
               AND NOT EXISTS (
                 SELECT 1 FROM cola_envio q
                 WHERE q.registro_id = r.id
                   AND q.estado <> 'enviado'
               )
             LIMIT ?`,
            [scope.localPatientId, cutoffDate, scope.owner, scope.environment, remainingQuota],
          )
        : [];

    if (vitalCandidates.length === 0 && formCandidates.length === 0) {
      break;
    }

    await db.transaction(async (tx) => {
      if (vitalCandidates.length > 0) {
        const vIds = vitalCandidates.map((v) => v.id);
        const vPlaceholders = vIds.map(() => '?').join(',');
        await tx.run(`DELETE FROM signos_vitales WHERE id IN (${vPlaceholders})`, vIds);
        await tx.run(
          `DELETE FROM qc_clinical_command
           WHERE id IN (${vPlaceholders})
             AND owner = ?
             AND environment = ?
             AND status = 'aceptado'`,
          [...vIds, scope.owner, scope.environment],
        );
        purgedTotal += vIds.length;
      }

      if (formCandidates.length > 0) {
        const fIds = formCandidates.map((f) => f.id);
        const fPlaceholders = fIds.map(() => '?').join(',');
        await tx.run(`DELETE FROM respuesta_formulario WHERE id IN (${fPlaceholders})`, fIds);
        await tx.run(
          `DELETE FROM qc_clinical_command
           WHERE id IN (${fPlaceholders})
             AND owner = ?
             AND environment = ?
             AND status = 'aceptado'`,
          [...fIds, scope.owner, scope.environment],
        );
        purgedTotal += fIds.length;
      }
    });

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
