import type { SqlConnection } from '../core/sql';
import { ExpoFileStorageAdapter, type FileStorageAdapter } from '../files/file-storage-adapter';
import { isPathInPatientMediaDirectory } from '../files/educational-storage';
import { assertSafeId, withPatientResourceLock } from '../files/resource-storage';

const defaultExpoAdapter = new ExpoFileStorageAdapter();

export interface CleanupResult {
  processed: number;
  deleted: number;
  failed: number;
  errors: Array<{ contentId: string; error: string }>;
}

/**
 * Limpieza física recuperable de copias retiradas (Markdown):
 * 1. Adquiere el bloqueo de recursos del paciente (withPatientResourceLock).
 * 2. Consulta las filas retiradas del paciente (retirado_en IS NOT NULL).
 * 3. Dentro del bloqueo, re-lee cada fila para garantizar que sigue retirada y con la misma ruta
 *    (descartando el retiro si fue reemplazada por una imagen activa).
 * 4. Valida estrictamente que la ruta pertenece al directorio del paciente.
 * 5. Si el archivo existe físicamente, intenta eliminarlo con el adaptador.
 * 6. Si el borrado físico falla, conserva la fila en SQLite y registra el mensaje de error en ultimo_error_retiro.
 * 7. Si el borrado físico tiene éxito o el archivo ya no existía, elimina la fila de SQLite mediante DELETE condicionado.
 */
export async function cleanupRetiredEducationalCopies(
  database: SqlConnection,
  patientId: string,
  options?: {
    adapter?: FileStorageAdapter;
    baseDirResolver?: (pacienteId: string) => string;
  },
): Promise<CleanupResult> {
  assertSafeId(patientId, 'pacienteId');

  const adapter = options?.adapter ?? defaultExpoAdapter;

  return withPatientResourceLock(patientId, async () => {
    const retiredRows = await database.all<{
      paciente_id: string;
      contenido_id: string;
      ruta_local: string | null;
      formato: string;
      retirado_en: string | null;
      ultimo_error_retiro: string | null;
    }>(
      `SELECT paciente_id, contenido_id, ruta_local, formato, retirado_en, ultimo_error_retiro
       FROM descarga
       WHERE paciente_id = ? AND retirado_en IS NOT NULL`,
      [patientId],
    );

    let processed = 0;
    let deleted = 0;
    let failed = 0;
    const errors: Array<{ contentId: string; error: string }> = [];

    for (const row of retiredRows) {
      processed++;

      // Re-consultar el registro dentro del bloqueo para comprobar que sigue retirado y conserva la misma ruta
      const freshRow = await database.first<{
        paciente_id: string;
        contenido_id: string;
        ruta_local: string | null;
        formato: string;
        retirado_en: string | null;
        ultimo_error_retiro: string | null;
      }>(
        `SELECT paciente_id, contenido_id, ruta_local, formato, retirado_en, ultimo_error_retiro
         FROM descarga
         WHERE paciente_id = ? AND contenido_id = ?`,
        [patientId, row.contenido_id],
      );

      if (!freshRow || freshRow.retirado_en === null || freshRow.ruta_local !== row.ruta_local) {
        // La copia fue sustituida por una imagen activa o ya no está retirada con esa ruta; omitir
        continue;
      }

      const rutaLocal = row.ruta_local;

      // Si la fila no tiene ruta local registrada, solo limpiamos el registro de SQLite
      if (!rutaLocal) {
        await database.run(
          `DELETE FROM descarga
           WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NOT NULL AND ruta_local IS NULL`,
          [patientId, row.contenido_id],
        );
        deleted++;
        continue;
      }

      // Validar que la ruta pertenezca de forma segura al directorio del paciente
      const isPathSafe = isPathInPatientMediaDirectory(
        rutaLocal,
        patientId,
        row.contenido_id,
        options?.baseDirResolver,
        { allowLegacy: true },
      );

      if (!isPathSafe) {
        const errorMsg = 'Ruta de archivo no pertenece al directorio seguro del paciente.';
        await database.run(
          `UPDATE descarga
           SET ultimo_error_retiro = ?
           WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NOT NULL AND ruta_local = ?`,
          [errorMsg, patientId, row.contenido_id, rutaLocal],
        );
        failed++;
        errors.push({ contentId: row.contenido_id, error: errorMsg });
        continue;
      }

      // Comprobar existencia física
      let fileExists = false;
      try {
        fileExists = await adapter.exists(rutaLocal);
      } catch {
        // Ignorar error al comprobar existencia
      }

      if (fileExists) {
        try {
          await adapter.deleteFile(rutaLocal);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await database.run(
            `UPDATE descarga
             SET ultimo_error_retiro = ?
             WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NOT NULL AND ruta_local = ?`,
            [errorMsg, patientId, row.contenido_id, rutaLocal],
          );
          failed++;
          errors.push({ contentId: row.contenido_id, error: errorMsg });
          continue;
        }
      }

      // Borrado físico exitoso o archivo ya no existía en disco: eliminar de SQLite
      await database.run(
        `DELETE FROM descarga
         WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NOT NULL AND ruta_local = ?`,
        [patientId, row.contenido_id, rutaLocal],
      );
      deleted++;
    }

    return {
      processed,
      deleted,
      failed,
      errors,
    };
  });
}
