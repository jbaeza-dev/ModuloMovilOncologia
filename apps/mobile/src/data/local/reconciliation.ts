export type ReconciliationResult = {
  markedUnavailable: number;
  cleanedOrphans: number;
  failedDeletions: number;
};

export type ReconciliationOps = {
  markDbUnavailable: (contenidoId: string) => Promise<void>;
  deleteDisk: (uri: string) => Promise<boolean>;
  checkDiskExists: (uri: string) => boolean | Promise<boolean>;
};

/**
 * Conciliación bidireccional entre registros de descarga en base de datos y archivos físicos en disco.
 * 1) Detecta archivos ausentes en disco y actualiza su estado en base de datos a no disponible.
 * 2) Detecta y elimina archivos huérfanos en disco, ignorando aquellos con escrituras en curso.
 */
export async function reconcileCopiesCore(
  dbRecords: Array<{ contenido_id: string; ruta_local: string | null; estado?: string }>,
  diskFileUris: string[],
  ops: ReconciliationOps,
  activeWrites?: Set<string>,
): Promise<ReconciliationResult> {
  let markedUnavailable = 0;
  let cleanedOrphans = 0;
  let failedDeletions = 0;
  const validDbUris = new Set<string>();

  const norm = (p: string) => p.replace(/\\/g, '/');

  // 1. Detección de archivos ausentes en disco
  for (const record of dbRecords) {
    if (!record.ruta_local) {
      if (record.estado !== 'error') {
        await ops.markDbUnavailable(record.contenido_id);
        markedUnavailable++;
      }
      continue;
    }
    const exists = await ops.checkDiskExists(record.ruta_local);
    if (!exists) {
      if (record.estado !== 'error') {
        await ops.markDbUnavailable(record.contenido_id);
        markedUnavailable++;
      }
    } else {
      validDbUris.add(norm(record.ruta_local));
      validDbUris.add(record.ruta_local);
    }
  }

  // 2. Limpieza de disco: archivos huérfanos sin registro en base de datos
  for (const uri of diskFileUris) {
    const normalizedUri = norm(uri);
    // Si la URI corresponde a una escritura activa en curso, se preserva
    if (activeWrites) {
      if (activeWrites.has(uri) || activeWrites.has(normalizedUri)) {
        continue;
      }
    }
    if (!validDbUris.has(uri) && !validDbUris.has(normalizedUri)) {
      const deleted = await ops.deleteDisk(uri);
      if (deleted) {
        cleanedOrphans++;
      } else {
        failedDeletions++;
      }
    }
  }

  return { markedUnavailable, cleanedOrphans, failedDeletions };
}
