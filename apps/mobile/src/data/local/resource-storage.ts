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

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Registro en memoria de escrituras de archivos en curso (in-flight).
 * La conciliación omite estos archivos para no borrarlos como huérfanos antes del commit en SQLite.
 */
const activeWrites = new Set<string>();

export function registerActiveWrite(fileUriOrUris: string | string[]): () => void {
  const uris = (Array.isArray(fileUriOrUris) ? fileUriOrUris : [fileUriOrUris]).map(normalizePath);
  for (const u of uris) {
    activeWrites.add(u);
  }
  return () => {
    for (const u of uris) {
      activeWrites.delete(u);
    }
  };
}

export function isFileWriteInFlight(fileUri: string): boolean {
  return activeWrites.has(normalizePath(fileUri));
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
 * Comprueba si un nombre de archivo corresponde exactamente a un recurso educativo:
 * Acepta exactamente `${contenidoId}.md` o `${contenidoId}_${timestamp}.md` (donde timestamp son dígitos).
 * Previene colisiones por prefijo (ej. 'guia' vs 'guia_extra').
 */
export function isResourceFileForContent(fileName: string, contenidoId: string): boolean {
  assertSafeId(contenidoId, 'contenidoId');
  if (fileName === `${contenidoId}.md`) return true;
  const prefix = `${contenidoId}_`;
  if (!fileName.startsWith(prefix) || !fileName.endsWith('.md')) return false;
  const middle = fileName.slice(prefix.length, -3);
  return /^\d+$/.test(middle);
}

/**
 * Valida estrictamente que una ruta pertenezca al directorio del paciente activo y no
 * acceda a rutas de otros pacientes o del sistema mediante path traversal.
 */
export function isPathInPatientResourceDirectory(
  ruta: string,
  pacienteId: string,
  contenidoId?: string,
  baseDirResolver?: (pacienteId: string) => string,
): boolean {
  assertSafeId(pacienteId, 'pacienteId');
  if (contenidoId) assertSafeId(contenidoId, 'contenidoId');

  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientResourceDirectory(pacienteId).uri;

  const normalizedBase = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedRuta = ruta.replace(/\\/g, '/');

  if (!normalizedRuta.startsWith(normalizedBase + '/')) {
    return false;
  }

  const relative = normalizedRuta.slice(normalizedBase.length + 1);
  if (relative.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    return false;
  }

  if (contenidoId) {
    const basename = relative.split('/').pop() || '';
    return isResourceFileForContent(basename, contenidoId);
  }

  return true;
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
 * 1. Registra tanto .tmp como .md en activeWrites para evitar su borrado prematuro en conciliación/limpieza.
 * 2. Escribe en archivo temporal .tmp con token sincronizado.
 * 3. Mueve a .md con overwrite nativo.
 * 4. Ejecuta inserción/actualización en SQLite.
 * 5. Si SQLite falla: compensación inmediata borrando el archivo físico de disco.
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

  // Registra AMBOS archivos en activeWrites para proteger al .tmp y al .md durante todo el ciclo
  const unregister = registerActiveWrite([tmpUri, finalUri]);

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
    // Verificar estrictamente que la ruta pertenezca al paciente y coincida con el contenido
    if (!isPathInPatientResourceDirectory(rutaLocal, pacienteId, contenidoId)) {
      return false;
    }
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
        if (isResourceFileForContent(name, contenidoId)) {
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
    if (isPathInPatientResourceDirectory(rutaLocal, pacienteId, contenidoId)) {
      try {
        const file = new File(rutaLocal);
        if (file.exists) return true;
      } catch {
        // Ignorar fallo de URI
      }
    }
  }
  const dir = getPatientResourceDirectory(pacienteId);
  if (!dir.exists) return false;
  try {
    const entries = dir.list();
    for (const entry of entries) {
      if (entry instanceof File) {
        const name = Paths.basename(entry.uri);
        if (isResourceFileForContent(name, contenidoId)) {
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
    if (isPathInPatientResourceDirectory(rutaLocal, pacienteId, contenidoId)) {
      try {
        const file = new File(rutaLocal);
        if (file.exists) {
          return file.text();
        }
      } catch {
        // Continuar al fallback
      }
    }
  }
  const dir = getPatientResourceDirectory(pacienteId);
  if (!dir.exists) return null;
  try {
    const entries = dir.list();
    for (const entry of entries) {
      if (entry instanceof File) {
        const name = Paths.basename(entry.uri);
        if (isResourceFileForContent(name, contenidoId)) {
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
