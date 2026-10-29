import { scopedClinicalDirectory } from '../../sync/file-protection';
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

export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const wait = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await wait;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

const patientResourceMutexes = new Map<string, AsyncMutex>();

export function getPatientResourceMutex(pacienteId: string): AsyncMutex {
  let mutex = patientResourceMutexes.get(pacienteId);
  if (!mutex) {
    mutex = new AsyncMutex();
    patientResourceMutexes.set(pacienteId, mutex);
  }
  return mutex;
}

export function withPatientResourceLock<T>(pacienteId: string, task: () => Promise<T>): Promise<T> {
  return getPatientResourceMutex(pacienteId).runExclusive(task);
}

const defaultExpoAdapter = new ExpoFileStorageAdapter();

export function getPatientResourceDirectory(pacienteId: string): Directory {
  assertSafeId(pacienteId, 'pacienteId');
  const scoped = scopedClinicalDirectory('recursos_educativos', pacienteId);
  return scoped
    ? new Directory(scoped)
    : new Directory(Paths.document, 'recursos_educativos', pacienteId);
}

/**
 * Comprueba si un nombre de archivo corresponde a un recurso educativo:
 * - Acepta exactamente `${contenidoId}.md`
 * - Acepta el formato con punto delimitador: `${contenidoId}.${timestamp}.md` (donde timestamp son dígitos).
 * - Con options.allowLegacy = true, acepta también el formato anterior con guion bajo: `${contenidoId}_${timestamp}.md`
 *   (para dar soporte a rutas exactas ya registradas en SQLite sin reintroducir barridos ambiguos por prefijo).
 */
const VALID_EDUCATIONAL_EXTS = new Set(['md', 'png', 'jpg', 'jpeg']);

export function isResourceFileForContent(
  fileName: string,
  contenidoId: string,
  options?: { allowLegacy?: boolean; validExtensions?: string[] },
): boolean {
  assertSafeId(contenidoId, 'contenidoId');
  const allowed = options?.validExtensions
    ? new Set(options.validExtensions.map((e) => e.replace(/^\./, '').toLowerCase()))
    : VALID_EDUCATIONAL_EXTS;

  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx <= 0) return false;
  const ext = fileName.slice(dotIdx + 1).toLowerCase();
  if (!allowed.has(ext)) return false;

  const nameWithoutExt = fileName.slice(0, dotIdx);
  if (nameWithoutExt === contenidoId) return true;

  // Formato estándar delimitado por punto
  const prefix = `${contenidoId}.`;
  if (nameWithoutExt.startsWith(prefix)) {
    const token = nameWithoutExt.slice(prefix.length);
    if (/^[0-9a-zA-Z.-]+$/.test(token) && !token.includes('..')) {
      return true;
    }
  }

  // Compatibilidad con formato anterior guardado con guion bajo (exclusivamente timestamp numérico)
  if (options?.allowLegacy) {
    const legacyPrefix = `${contenidoId}_`;
    if (nameWithoutExt.startsWith(legacyPrefix)) {
      const token = nameWithoutExt.slice(legacyPrefix.length);
      if (/^\d+$/.test(token)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Reconoce si un nombre de archivo corresponde a un recurso educativo propio (.md, .png, .jpg, .jpeg)
 * según IDs conocidos de base de datos / catálogo o formato estructurado con timestamp.
 * Preserva intactos archivos desconocidos (otros formatos o nombres arbitrarios).
 */
export function isRecognizedEducationalFileName(
  fileName: string,
  knownContentIds?: Set<string>,
): boolean {
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx <= 0) return false;
  const ext = fileName.slice(dotIdx + 1).toLowerCase();
  if (!VALID_EDUCATIONAL_EXTS.has(ext)) return false;

  // 1. Si coincide con alguno de los IDs registrados conocidos
  if (knownContentIds && knownContentIds.size > 0) {
    for (const cId of knownContentIds) {
      if (isResourceFileForContent(fileName, cId, { allowLegacy: true })) {
        return true;
      }
    }
  }

  // 2. Estructura estándar de token generado por el coordinador:
  // <contentId>.<timestamp>.<uuid>.<ext> o <contentId>.<timestamp>.<ext>
  const nameWithoutExt = fileName.slice(0, dotIdx);
  const dotParts = nameWithoutExt.split('.');
  if (dotParts.length >= 2) {
    const possibleId = dotParts[0];
    const timestampPart = dotParts[1];
    if (
      /^[a-zA-Z0-9_-]+$/.test(possibleId) &&
      /^\d{10,}$/.test(timestampPart) &&
      !nameWithoutExt.includes('..')
    ) {
      return true;
    }
  }

  // Formato legado delimitado por guion bajo: <contentId>_<timestamp>.<ext>
  const underscoreParts = nameWithoutExt.split('_');
  if (underscoreParts.length === 2) {
    const [possibleId, timestamp] = underscoreParts;
    if (/^[a-zA-Z0-9_-]+$/.test(possibleId) && /^\d{10,}$/.test(timestamp)) {
      return true;
    }
  }

  return false;
}

/**
 * Valida estrictamente que una ruta pertenezca al directorio del paciente activo y no
 * acceda a rutas de otros pacientes o del sistema mediante path traversal.
 * Permite compatibilidad con formato legado si se especifica options.allowLegacy.
 */
export function isPathInPatientResourceDirectory(
  ruta: string,
  pacienteId: string,
  contenidoId?: string,
  baseDirResolver?: (pacienteId: string) => string,
  options?: { allowLegacy?: boolean },
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
    return isResourceFileForContent(basename, contenidoId, options);
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
  const token = `${contenidoId}.${timestamp}`;
  const tmpName = `${token}.tmp`;
  const finalName = `${token}.md`;

  const tmpFile = new File(dir, tmpName);
  await tmpFile.write(content);

  const finalFile = new File(dir, finalName);
  await tmpFile.move(finalFile);

  return finalFile.uri;
}

/**
 * Coordinador de guardado seguro con compensación y exclusión mutua por paciente:
 * 1. Coordina mediante withPatientResourceLock para evitar carreras con conciliación/lectura concurrente.
 * 2. Registra tanto .tmp como .md en activeWrites para evitar su borrado prematuro.
 * 3. Escribe en archivo temporal .tmp con token sincronizado.
 * 4. Mueve a .md con overwrite nativo.
 * 5. Ejecuta inserción/actualización en SQLite.
 * 6. Si SQLite falla: compensación inmediata borrando el archivo físico de disco.
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

  return withPatientResourceLock(pacienteId, async () => {
    const baseDir = baseDirResolver
      ? baseDirResolver(pacienteId)
      : getPatientResourceDirectory(pacienteId).uri;

    await adapter.ensureDirectory(baseDir);

    const baseDirClean = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const timestamp = Date.now();
    const token = `${contenidoId}.${timestamp}`;
    const tmpUri = `${baseDirClean}/${token}.tmp`;
    const finalUri = `${baseDirClean}/${token}.md`;

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
  });
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

  const dirExists = adapter.directoryExists
    ? await adapter.directoryExists(baseDir)
    : await adapter.exists(baseDir);
  if (!dirExists) return 0;

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
 * Si se especifica rutaLocal (la registrada en SQLite), opera exclusivamente sobre ella
 * tras validar pertenencia estricta, sin barrer ni afectar otros archivos del paciente.
 */
export async function deleteResourceFile(
  pacienteId: string,
  contenidoId: string,
  rutaLocal?: string | null,
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<boolean> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

  if (rutaLocal) {
    // Verificar estrictamente que la ruta pertenezca al paciente y coincida con el contenido,
    // admitiendo copias previas registradas en SQLite
    if (
      !isPathInPatientResourceDirectory(rutaLocal, pacienteId, contenidoId, baseDirResolver, {
        allowLegacy: true,
      })
    ) {
      return false;
    }
    // Si el archivo físico ya no existe en disco, se confirma ausente: seguro para limpiar SQLite
    if (!(await adapter.exists(rutaLocal))) {
      return true;
    }
    const deleted = await adapter.deleteFile(rutaLocal);
    // Verificar que el archivo realmente haya desaparecido de disco tras el intento
    if (!deleted || (await adapter.exists(rutaLocal))) {
      return false;
    }
    return true;
  }

  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientResourceDirectory(pacienteId).uri;

  const dirExists = adapter.directoryExists
    ? await adapter.directoryExists(baseDir)
    : await adapter.exists(baseDir);
  if (!dirExists) return true;
  let success = true;
  try {
    const files = await adapter.listDirectory(baseDir);
    for (const fileUri of files) {
      const name = fileUri.split(/[\\/]/).pop() || '';
      if (isResourceFileForContent(name, contenidoId)) {
        const deleted = await adapter.deleteFile(fileUri);
        if (!deleted) success = false;
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
  baseDirResolver?: (pacienteId: string) => string,
): boolean {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

  if (rutaLocal) {
    if (
      isPathInPatientResourceDirectory(rutaLocal, pacienteId, contenidoId, baseDirResolver, {
        allowLegacy: true,
      })
    ) {
      try {
        const file = new File(rutaLocal);
        if (file.exists) return true;
      } catch {
        // Ignorar fallo de URI
      }
    }
  }
  if (rutaLocal) return false;
  const dir = baseDirResolver
    ? new Directory(baseDirResolver(pacienteId))
    : getPatientResourceDirectory(pacienteId);
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
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<string | null> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

  if (rutaLocal) {
    if (
      isPathInPatientResourceDirectory(rutaLocal, pacienteId, contenidoId, baseDirResolver, {
        allowLegacy: true,
      })
    ) {
      try {
        if (await adapter.exists(rutaLocal)) {
          return adapter.readText(rutaLocal);
        }
      } catch {
        // Continuar al fallback
      }
    }
  }
  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientResourceDirectory(pacienteId).uri;
  const dirExists = adapter.directoryExists
    ? await adapter.directoryExists(baseDir)
    : await adapter.exists(baseDir);
  if (!dirExists) return null;
  try {
    const files = await adapter.listDirectory(baseDir);
    for (const fileUri of files) {
      const name = fileUri.split(/[\\/]/).pop() || '';
      if (isResourceFileForContent(name, contenidoId)) {
        return adapter.readText(fileUri);
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
 * Se coordina mediante withPatientResourceLock e incluye comprobación protegida
 * antes del borrado para evitar eliminar archivos confirmados durante lecturas concurrentes.
 * Contempla extensiones .md, .png, .jpg, .jpeg y reconoce nombres propios de recursos,
 * preservando intactos archivos desconocidos y escrituras activas en curso.
 */
export async function reconcileResourceCopies(
  pacienteId: string,
  repository: {
    downloads: () => Promise<
      Array<{ contenido_id: string; ruta_local: string | null; estado?: string }>
    >;
    markDownloadUnavailable: (contenidoId: string) => Promise<void>;
  },
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<ReconciliationResult> {
  assertSafeId(pacienteId, 'pacienteId');

  return withPatientResourceLock(pacienteId, async () => {
    // Limpiar temporales abandonados en segundo plano
    await cleanDanglingTempFiles(pacienteId, adapter, baseDirResolver).catch(() => 0);

    const baseDir = baseDirResolver
      ? baseDirResolver(pacienteId)
      : getPatientResourceDirectory(pacienteId).uri;
    const diskUris: string[] = [];

    const dirExists = adapter.directoryExists
      ? await adapter.directoryExists(baseDir)
      : await adapter.exists(baseDir);

    const dbRecords = await repository.downloads();
    const knownContentIds = new Set(dbRecords.map((r) => r.contenido_id));

    if (dirExists) {
      try {
        const entries = await adapter.listDirectory(baseDir);
        for (const entryUri of entries) {
          const fileName = entryUri.split(/[\\/]/).pop() || '';
          // Reconocer nombres propios (.md, .png, .jpg, .jpeg) preservando archivos desconocidos
          if (isRecognizedEducationalFileName(fileName, knownContentIds)) {
            diskUris.push(entryUri);
          }
        }
      } catch {
        // Ignorar fallo al listar
      }
    }

    return reconcileCopiesCore(
      dbRecords,
      diskUris,
      {
        markDbUnavailable: async (id) => repository.markDownloadUnavailable(id),
        deleteDisk: async (uri) => adapter.deleteFile(uri),
        checkDiskExists: async (uri) => adapter.exists(uri),
        isProtectedOrphan: async (uri) => {
          if (isFileWriteInFlight(uri)) return true;
          const fresh = await repository.downloads();
          const normUri = uri.replace(/\\/g, '/');
          return fresh.some(
            (r) =>
              r.ruta_local &&
              (r.ruta_local === uri || r.ruta_local.replace(/\\/g, '/') === normUri),
          );
        },
      },
      getActiveWrites(),
    );
  });
}
