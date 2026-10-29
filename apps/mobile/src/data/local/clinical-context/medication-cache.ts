import type { SqlConnection } from '../core/sql';
import type { IdentityCache } from '../../../services/session/http-session-types';
import { isUuid } from '../../../services/session/response-checks';
import { ingestClinicalContextInTransaction } from './clinical-context-ingestion';

/** Explicitly selected REST indication, copied without fabricating missing dose/frequency. */
export async function cacheMedicationForReminder(
  db: SqlConnection,
  localPatientId: string,
  identity: IdentityCache,
  medicationId: string,
  assertContext: () => void,
) {
  assertContext();
  const medication = identity.clinicalProfile?.medicamentos?.find((m) => m.id === medicationId);
  if (
    !identity.clinicalProfile ||
    !medication ||
    !isUuid(medication.id) ||
    medication.activo !== true ||
    !medication.nombre?.trim() ||
    !medication.dosis?.trim() ||
    !medication.frecuencia?.trim()
  )
    throw new Error('La indicación no tiene datos suficientes para configurar un aviso.');
  await db.transaction(async (tx) => {
    assertContext();
    await ingestClinicalContextInTransaction(tx, {
      fichas: [
        {
          fichaId: identity.clinicalProfile!.id,
          pacienteId: localPatientId,
          obtenidoEn: identity.fetchedAt,
        },
      ],
      medicamentos: [
        {
          id: medication.id,
          pacienteId: localPatientId,
          fichaId: identity.clinicalProfile!.id,
          nombre: medication.nombre!,
          dosis: medication.dosis!,
          frecuencia: medication.frecuencia!,
          fechaInicio: medication.fecha_inicio,
          fechaFin: medication.fecha_termino,
          estadoActivo: true,
          obtenidoEn: identity.fetchedAt,
        },
      ],
    });
    assertContext();
  });
}
