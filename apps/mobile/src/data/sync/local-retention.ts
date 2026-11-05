import type { SqlConnection } from '../local/core/sql';

export const DEFAULT_RETAIN_SYNCED_COUNT = 5;

export interface PruneOptions {
  retainCount?: number;
}

/**
 * Purgado seguro de registros locales ya sincronizados.
 *
 * Reglas fundamentales de integridad y seguridad clínica:
 * 1. NUNCA elimina registros pendientes de sincronización (sin acuse de recibo del servidor).
 * 2. Conserva intactos los `retainCount` registros sincronizados más recientes para el paciente.
 * 3. Elimina únicamente los registros sincronizados más antiguos que superen la cuota fijada,
 *    limpiando también sus comandos ya archivados para mantener la base de datos local ligera y eficiente.
 */
export async function pruneSynchronizedRecords(
  connection: SqlConnection,
  localPatientId: string,
  owner: string,
  kind: 'signos' | 'epro',
  options: PruneOptions = {},
): Promise<number> {
  const retain = options.retainCount ?? DEFAULT_RETAIN_SYNCED_COUNT;
  if (!Number.isInteger(retain) || retain < 1) return 0;

  if (kind === 'signos') {
    const syncedRows = await connection.all<{ id: string }>(
      `SELECT id FROM signos_vitales 
       WHERE paciente_id = ? AND fecha_subida IS NOT NULL 
       ORDER BY fecha_registro DESC, id DESC`,
      [localPatientId],
    );

    if (syncedRows.length <= retain) return 0;

    const toDeleteIds = syncedRows.slice(retain).map((r) => r.id);
    if (!toDeleteIds.length) return 0;

    const placeholders = toDeleteIds.map(() => '?').join(',');

    await connection.run(
      `DELETE FROM signos_vitales WHERE paciente_id = ? AND id IN (${placeholders})`,
      [localPatientId, ...toDeleteIds],
    );
    await connection.run(
      `DELETE FROM cola_envio WHERE paciente_id = ? AND registro_id IN (${placeholders})`,
      [localPatientId, ...toDeleteIds],
    );
    await connection.run(
      `DELETE FROM qc_clinical_command WHERE owner = ? AND id IN (${placeholders})`,
      [owner, ...toDeleteIds],
    );

    return toDeleteIds.length;
  }

  if (kind === 'epro') {
    const syncedRows = await connection.all<{ id: string }>(
      `SELECT rf.id FROM respuesta_formulario rf
       INNER JOIN qc_clinical_command cmd ON cmd.id = rf.id
       WHERE rf.paciente_id = ? AND cmd.owner = ? AND cmd.kind = 'epro' AND cmd.status = 'aceptado'
       ORDER BY rf.fecha_confirmacion DESC, rf.id DESC`,
      [localPatientId, owner],
    );

    if (syncedRows.length <= retain) return 0;

    const toDeleteIds = syncedRows.slice(retain).map((r) => r.id);
    if (!toDeleteIds.length) return 0;

    const placeholders = toDeleteIds.map(() => '?').join(',');

    await connection.run(
      `DELETE FROM respuesta_formulario WHERE paciente_id = ? AND id IN (${placeholders})`,
      [localPatientId, ...toDeleteIds],
    );
    await connection.run(
      `DELETE FROM cola_envio WHERE paciente_id = ? AND registro_id IN (${placeholders})`,
      [localPatientId, ...toDeleteIds],
    );
    await connection.run(
      `DELETE FROM qc_clinical_command WHERE owner = ? AND id IN (${placeholders})`,
      [owner, ...toDeleteIds],
    );

    return toDeleteIds.length;
  }

  return 0;
}
