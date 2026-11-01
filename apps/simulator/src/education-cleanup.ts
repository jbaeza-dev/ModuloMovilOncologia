import { readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from './db.js';
import type { SimulatorConfig } from './config.js';
import { isMaintenanceActive, setMaintenanceActive, drainPublishes } from './mutation-gate.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Reconciliador seguro de archivos educativos huérfanos.
 * Comprueba todas las referencias existentes en la base de datos (activas e inactivas).
 * Si la consulta a PostgreSQL falla, se abstiene de realizar cualquier eliminación.
 */
async function reconcileFiles(
  config: SimulatorConfig,
  db: Database,
  minAgeMs: number = ONE_HOUR_MS,
): Promise<{ scanned: number; removed: number; preserved: number }> {
  let rows: { id: string; archivo_revision: string }[];
  try {
    const result = await db.query<{ id: string; archivo_revision: string }>(
      'SELECT id, archivo_revision FROM contenido_educativo WHERE archivo_revision IS NOT NULL',
    );
    rows = result.rows;
  } catch (error) {
    // Salvaguarda: Si falla la consulta a la base de datos, abortar inmediatamente sin tocar ningún archivo
    console.error(
      '[Reconciliador] Error al consultar PostgreSQL. Abortando limpieza de huérfanos.',
      error,
    );
    return { scanned: 0, removed: 0, preserved: 0 };
  }

  const validSet = new Set<string>();
  for (const row of rows) {
    validSet.add(`${row.id}/${row.archivo_revision}`.toLowerCase());
  }

  let scanned = 0;
  let removed = 0;
  let preserved = 0;

  try {
    const rootStat = await lstat(config.educationMediaRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      return { scanned, removed, preserved };
    const entries = await readdir(config.educationMediaRoot, { withFileTypes: true });
    const now = Date.now();

    for (const dir of entries) {
      if (!dir.isDirectory()) continue;
      if (!/^[0-9a-f-]{36}$/i.test(dir.name)) continue;
      const contentId = dir.name.toLowerCase();
      const contentDirPath = join(config.educationMediaRoot, dir.name);

      const directoryStat = await lstat(contentDirPath);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue;
      let files: string[];
      try {
        files = await readdir(contentDirPath);
      } catch {
        continue;
      }

      for (const fileName of files) {
        if (!/^[0-9a-f-]{36}\.(png|jpg)$/i.test(fileName)) continue;
        scanned++;
        const extIndex = fileName.lastIndexOf('.');
        const revision = (extIndex !== -1 ? fileName.slice(0, extIndex) : fileName).toLowerCase();
        const key = `${contentId}/${revision}`;
        const filePath = join(contentDirPath, fileName);

        if (validSet.has(key)) {
          preserved++;
          continue;
        }

        // El archivo no tiene registro en PostgreSQL. Verificar antigüedad mínima
        try {
          const fileStat = await lstat(filePath);
          if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
          const ageMs = now - fileStat.mtimeMs;
          if (minAgeMs === 0 || ageMs >= minAgeMs) {
            const check = await db.query(
              'SELECT id FROM contenido_educativo WHERE id=$1 AND archivo_revision=$2',
              [contentId, revision],
            );
            if (check.rowCount) {
              preserved++;
              continue;
            }
            await unlink(filePath);
            removed++;
          } else {
            preserved++;
          }
        } catch {
          // Ignorar errores al acceder a archivo individual
        }
      }

      // Si el directorio de contenido quedó vacío, limpiarlo
      try {
        const remaining = await readdir(contentDirPath);
        if (remaining.length === 0) {
          await rmdir(contentDirPath);
        }
      } catch {
        // Ignorar
      }
    }
  } catch {
    // Si la carpeta raíz no existe aún, no hay nada que reconciliar
  }

  return { scanned, removed, preserved };
}

export async function reconcileOrphanEducationFiles(
  config: SimulatorConfig,
  db: Database,
  minAgeMs = ONE_HOUR_MS,
) {
  if (isMaintenanceActive()) return { scanned: 0, removed: 0, preserved: 0 };
  setMaintenanceActive(true);
  try {
    if (!(await drainPublishes(15000))) return { scanned: 0, removed: 0, preserved: 0 };
    return await reconcileFiles(config, db, minAgeMs);
  } finally {
    setMaintenanceActive(false);
  }
}
