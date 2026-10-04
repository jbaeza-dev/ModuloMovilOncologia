export type ReconciliationResult = {
  cleanedOrphans: number;
  cleanedStaleRecords: number;
};

export type ReconciliationOps = {
  removeDb: (contenidoId: string) => Promise<void>;
  deleteDisk: (uri: string) => Promise<void>;
  checkDiskExists: (uri: string) => boolean | Promise<boolean>;
};

/**
 * Conciliación bidireccional pura entre registros de descarga en base de datos y archivos físicos en disco.
 * 1) Detecta y elimina filas en base de datos cuyos archivos ya no existen en disco.
 * 2) Detecta y elimina archivos en disco que no están vinculados a ningún registro válido en base de datos.
 */
export async function reconcileCopiesCore(
  dbRecords: Array<{ contenido_id: string; ruta_local: string | null }>,
  diskFileUris: string[],
  ops: ReconciliationOps,
): Promise<ReconciliationResult> {
  let cleanedStaleRecords = 0;
  let cleanedOrphans = 0;
  const validDbUris = new Set<string>();

  // 1. Limpieza de base de datos: registros que apuntan a archivos que ya no existen
  for (const record of dbRecords) {
    if (!record.ruta_local) {
      await ops.removeDb(record.contenido_id);
      cleanedStaleRecords++;
      continue;
    }
    const exists = await ops.checkDiskExists(record.ruta_local);
    if (!exists) {
      await ops.removeDb(record.contenido_id);
      cleanedStaleRecords++;
    } else {
      validDbUris.add(record.ruta_local);
    }
  }

  // 2. Limpieza de disco: archivos huérfanos sin registro en base de datos
  for (const uri of diskFileUris) {
    if (!validDbUris.has(uri)) {
      await ops.deleteDisk(uri);
      cleanedOrphans++;
    }
  }

  return { cleanedOrphans, cleanedStaleRecords };
}
