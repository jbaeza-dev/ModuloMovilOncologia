import { Directory, File, Paths } from 'expo-file-system';

import { reconcileCopiesCore, type ReconciliationResult } from './reconciliation';

export {
  reconcileCopiesCore,
  type ReconciliationOps,
  type ReconciliationResult,
} from './reconciliation';

export function getPatientResourceDirectory(pacienteId: string): Directory {
  return new Directory(Paths.document, 'recursos_educativos', pacienteId);
}

/**
 * Escribe una copia educativa con un nombre de archivo único con marca temporal
 * para evitar sobrescrituras destructivas antes de confirmar la persistencia en SQLite.
 */
export async function writeResourceFile(
  pacienteId: string,
  contenidoId: string,
  content: string,
): Promise<string> {
  const dir = getPatientResourceDirectory(pacienteId);
  dir.create({ intermediates: true, idempotent: true });
  const uniqueName = `${contenidoId}_${Date.now()}.md`;
  const file = new File(dir, uniqueName);
  file.write(content);
  return file.uri;
}

/**
 * Elimina un archivo específico por su URI local si existe en disco.
 */
export async function deleteFileByUri(uri: string): Promise<void> {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Si no se puede instanciar o borrar, se ignora de forma segura
  }
}

/**
 * Elimina cualquier copia física asociada a un contenidoId para el paciente dado.
 */
export async function deleteResourceFile(
  pacienteId: string,
  contenidoId: string,
  rutaLocal?: string | null,
): Promise<void> {
  if (rutaLocal) {
    await deleteFileByUri(rutaLocal);
  }
  const dir = getPatientResourceDirectory(pacienteId);
  if (!dir.exists) return;
  try {
    const entries = dir.list();
    for (const entry of entries) {
      if (entry instanceof File) {
        const name = Paths.basename(entry.uri);
        if (name === `${contenidoId}.md` || name.startsWith(`${contenidoId}_`)) {
          entry.delete();
        }
      }
    }
  } catch {
    // Manejo seguro ante directorios inaccesibles
  }
}

/**
 * Comprueba si el archivo físico de un recurso educativo existe en el almacenamiento del paciente.
 */
export function resourceFileExists(
  pacienteId: string,
  contenidoId: string,
  rutaLocal?: string | null,
): boolean {
  if (rutaLocal) {
    try {
      const file = new File(rutaLocal);
      if (file.exists) return true;
    } catch {
      // Ignorar fallo de URI
    }
  }
  const dir = getPatientResourceDirectory(pacienteId);
  if (!dir.exists) return false;
  try {
    const entries = dir.list();
    for (const entry of entries) {
      if (entry instanceof File) {
        const name = Paths.basename(entry.uri);
        if (name === `${contenidoId}.md` || name.startsWith(`${contenidoId}_`)) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Lee el contenido markdown de un recurso educativo guardado en disco.
 */
export async function readResourceFile(
  pacienteId: string,
  contenidoId: string,
  rutaLocal?: string | null,
): Promise<string | null> {
  if (rutaLocal) {
    try {
      const file = new File(rutaLocal);
      if (file.exists) {
        return file.text();
      }
    } catch {
      // Continuar al fallback
    }
  }
  const dir = getPatientResourceDirectory(pacienteId);
  if (!dir.exists) return null;
  try {
    const entries = dir.list();
    for (const entry of entries) {
      if (entry instanceof File) {
        const name = Paths.basename(entry.uri);
        if (name === `${contenidoId}.md` || name.startsWith(`${contenidoId}_`)) {
          return entry.text();
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Realiza la conciliación bidireccional entre la tabla `descarga` de SQLite
 * y el directorio físico de recursos del paciente en `expo-file-system`.
 */
export async function reconcileResourceCopies(
  pacienteId: string,
  repository: {
    downloads: () => Promise<Array<{ contenido_id: string; ruta_local: string | null }>>;
    removeDownload: (contenidoId: string) => Promise<void>;
  },
): Promise<ReconciliationResult> {
  const dir = getPatientResourceDirectory(pacienteId);
  const diskUris: string[] = [];
  if (dir.exists) {
    try {
      const entries = dir.list();
      for (const entry of entries) {
        if (entry instanceof File) {
          diskUris.push(entry.uri);
        }
      }
    } catch {
      // Ignorar fallo al listar
    }
  }

  const dbRecords = await repository.downloads();

  return reconcileCopiesCore(dbRecords, diskUris, {
    removeDb: async (id) => repository.removeDownload(id),
    deleteDisk: async (uri) => deleteFileByUri(uri),
    checkDiskExists: (uri) => {
      try {
        return new File(uri).exists;
      } catch {
        return false;
      }
    },
  });
}
