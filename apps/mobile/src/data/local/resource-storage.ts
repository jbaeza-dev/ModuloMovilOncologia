import { Directory, File, Paths } from 'expo-file-system';

import { ExpoFileStorageAdapter, type FileStorageAdapter } from './file-storage-adapter';
import { reconcileCopiesCore, type ReconciliationResult } from './reconciliation';

export {
  reconcileCopiesCore,
  type ReconciliationOps,
  type ReconciliationResult,
} from './reconciliation';

/**
 * Validadores específicos por dominio para prevenir path traversal y manipulación de rutas.
 */
export function assertSafeId(id: string, fieldName: string): void {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(
      `Identificador inválido para ${fieldName}: "${id}". Solo se permiten caracteres alfanuméricos, guiones y guiones bajos.`,
    );
  }
}

export function assertSafeVersion(version: string, fieldName: string): void {
  if (!version || !/^[a-zA-Z0-9._-]+$/.test(version)) {
    throw new Error(
      `Versión inválida para ${fieldName}: "${version}". Solo se permiten caracteres alfanuméricos, puntos y guiones.`,
    );
  }
}

/**
 * Registro en memoria de escrituras de archivos en curso (in-flight).
 * La conciliación omite estos archivos para no borrarlos como huérfanos antes del commit en SQLite.
 */
const activeWrites = new Set<string>();

export function registerActiveWrite(fileUri: string): () => void {
  activeWrites.add(fileUri);
  return () => {
    activeWrites.delete(fileUri);
  };
}

export function isFileWriteInFlight(fileUri: string): boolean {
  return activeWrites.has(fileUri);
}

export function getActiveWrites(): Set<string> {
  return new Set(activeWrites);
}

const defaultExpoAdapter = new ExpoFileStorageAdapter();

export function getPatientResourceDirectory(pacienteId: string): Directory {
  assertSafeId(pacienteId, 'pacienteId');
  return new Directory(Paths.document, 'recursos_educativos', pacienteId);
}

/**
 * Escribe una copia educativa utilizando un archivo temporal y la renombra al nombre final único.
 */
export async function writeResourceFile(
  pacienteId: string,
  contenidoId: string,
  content: string,
): Promise<string> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

  const dir = getPatientResourceDirectory(pacienteId);
  dir.create({ intermediates: true, idempotent: true });

  const timestamp = Date.now();
  const token = `${contenidoId}_${timestamp}`;
  const tmpName = `${token}.tmp`;
  const finalName = `${token}.md`;

  const tmpFile = new File(dir, tmpName);
  await tmpFile.write(content);

  const finalFile = new File(dir, finalName);
  await tmpFile.move(finalFile);

  return finalFile.uri;
}

/**
 * Coordinador de guardado seguro con compensación:
 * 1. Escribe en archivo temporal .tmp con token sincronizado.
 * 2. Mueve atómicamente a .md.
 * 3. Ejecuta inserción/actualización en SQLite.
 * 4. Si SQLite falla: compensación inmediata borrando el archivo físico de disco.
 * 5. Registra la URI en activeWrites para evitar colisiones con la conciliación concurrente.
 */
export async function saveResourceWithCompensation(
  pacienteId: string,
  contenidoId: string,
  content: string,
  saveToDb: (rutaLocal: string) => Promise<void>,
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<string> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientResourceDirectory(pacienteId).uri;

  await adapter.ensureDirectory(baseDir);

  const timestamp = Date.now();
  const token = `${contenidoId}_${timestamp}`;
  const tmpUri = baseDir.endsWith('/') ? `${baseDir}${token}.tmp` : `${baseDir}/${token}.tmp`;
  const finalUri = baseDir.endsWith('/') ? `${baseDir}${token}.md` : `${baseDir}/${token}.md`;

  const unregister = registerActiveWrite(finalUri);

  try {
    // 1. Escritura en temporal
    await adapter.writeText(tmpUri, content);

    // 2. Mover temporal a destino final
    await adapter.moveFile(tmpUri, finalUri, { overwrite: true });

    // 3. Confirmar persistencia en SQLite
    try {
      await saveToDb(finalUri);
      return finalUri;
    } catch (dbError) {
      // 4. Compensación ante error de SQLite: eliminar archivo de disco
      try {
        if (await adapter.exists(finalUri)) {
          await adapter.deleteFile(finalUri);
        }
      } catch {
        // Registro de fallo de compensación
      }
      throw dbError;
    }
  } finally {
    unregister();
  }
}

/**
 * Elimina archivos temporales (*.tmp) huérfanos generados por interrupciones previas.
 */
export async function cleanDanglingTempFiles(
  pacienteId: string,
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<number> {
  assertSafeId(pacienteId, 'pacienteId');
  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientResourceDirectory(pacienteId).uri;

  if (!(await adapter.exists(baseDir))) return 0;

  let cleaned = 0;
  try {
    const files = await adapter.listDirectory(baseDir);
    for (const fileUri of files) {
      if (fileUri.endsWith('.tmp') && !isFileWriteInFlight(fileUri)) {
        const deleted = await adapter.deleteFile(fileUri);
        if (deleted) cleaned++;
      }
    }
  } catch {
    // Manejo seguro
  }
  return cleaned;
}

/**
 * Elimina un archivo específico por su URI local de forma explícita.
 */
export async function deleteFileByUri(uri: string): Promise<boolean> {
  try {
    const file = new File(uri);
    if (file.exists) {
      await file.delete();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Elimina cualquier copia física asociada a un contenidoId para el paciente dado.
 */
export async function deleteResourceFile(
  pacienteId: string,
  contenidoId: string,
  rutaLocal?: string | null,
): Promise<boolean> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

  let success = true;
  if (rutaLocal) {
    const deleted = await deleteFileByUri(rutaLocal);
    if (!deleted) success = false;
  }
  const dir = getPatientResourceDirectory(pacienteId);
  if (!dir.exists) return success;
  try {
    const entries = dir.list();
    for (const entry of entries) {
      if (entry instanceof File) {
        const name = Paths.basename(entry.uri);
        if (name === `${contenidoId}.md` || name.startsWith(`${contenidoId}_`)) {
          try {
            await entry.delete();
          } catch {
            success = false;
          }
        }
      }
    }
  } catch {
    return false;
  }
  return success;
}

/**
 * Comprueba si el archivo físico de un recurso educativo existe en el almacenamiento del paciente.
 */
export function resourceFileExists(
  pacienteId: string,
  contenidoId: string,
  rutaLocal?: string | null,
): boolean {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

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
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

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
    downloads: () => Promise<
      Array<{ contenido_id: string; ruta_local: string | null; estado?: string }>
    >;
    markDownloadUnavailable: (contenidoId: string) => Promise<void>;
  },
): Promise<ReconciliationResult> {
  assertSafeId(pacienteId, 'pacienteId');

  // Limpiar temporales abandonados en segundo plano
  await cleanDanglingTempFiles(pacienteId).catch(() => 0);

  const dir = getPatientResourceDirectory(pacienteId);
  const diskUris: string[] = [];
  if (dir.exists) {
    try {
      const entries = dir.list();
      for (const entry of entries) {
        if (entry instanceof File && entry.uri.endsWith('.md')) {
          diskUris.push(entry.uri);
        }
      }
    } catch {
      // Ignorar fallo al listar
    }
  }

  const dbRecords = await repository.downloads();

  return reconcileCopiesCore(
    dbRecords,
    diskUris,
    {
      markDbUnavailable: async (id) => repository.markDownloadUnavailable(id),
      deleteDisk: async (uri) => deleteFileByUri(uri),
      checkDiskExists: (uri) => {
        try {
          return new File(uri).exists;
        } catch {
          return false;
        }
      },
    },
    getActiveWrites(),
  );
}
