import { scopedClinicalDirectory } from '../../data/sync/file-protection';
import { Directory, Paths } from 'expo-file-system';

import {
  ExpoFileStorageAdapter,
  type FileStorageAdapter,
} from '../../data/local/files/file-storage-adapter';
import {
  assertSafeId,
  assertSafeVersion,
  AsyncMutex,
} from '../../data/local/files/resource-storage';
import type { MedicalFormDraft } from './medical-form-types';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Registro de archivos de borradores en curso (temporales y respaldos activos)
 * para evitar su eliminación o manipulación por limpiezas concurrentes.
 */
const activeDraftWrites = new Set<string>();

export function registerActiveDraftWrite(fileUriOrUris: string | string[]): () => void {
  const uris = (Array.isArray(fileUriOrUris) ? fileUriOrUris : [fileUriOrUris]).map(normalizePath);
  for (const u of uris) {
    activeDraftWrites.add(u);
  }
  return () => {
    for (const u of uris) {
      activeDraftWrites.delete(u);
    }
  };
}

export function isDraftWriteInFlight(fileUri: string): boolean {
  return activeDraftWrites.has(normalizePath(fileUri));
}

const draftMutexes = new Map<string, AsyncMutex>();

export function getDraftMutex(draftPath: string): AsyncMutex {
  const key = normalizePath(draftPath);
  let mutex = draftMutexes.get(key);
  if (!mutex) {
    mutex = new AsyncMutex();
    draftMutexes.set(key, mutex);
  }
  return mutex;
}

export function withDraftLock<T>(draftPath: string, task: () => Promise<T>): Promise<T> {
  return getDraftMutex(draftPath).runExclusive(task);
}

/**
 * Comprueba si el contenido representa un borrador JSON legible, parseable y
 * perteneciente al paciente, formulario y versión esperados, con estructura íntegra de MedicalFormDraft.
 * Valida respuestas como objeto no nulo, valores admitidos, cadenas, completado booleano y fecha válida.
 */
export function isValidDraftPayload(
  content: string,
  expectedPatientId?: string,
  expectedFormId?: string,
  expectedVersion?: string,
): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }

    const rec = parsed as Record<string, unknown>;

    // Identificadores y versión requeridos como cadenas no vacías
    if (typeof rec.formularioId !== 'string' || rec.formularioId.trim().length === 0) return false;
    if (typeof rec.version !== 'string' || rec.version.trim().length === 0) return false;
    if (typeof rec.pacienteId !== 'string' || rec.pacienteId.trim().length === 0) return false;

    // Completado como booleano
    if (typeof rec.completado !== 'boolean') return false;

    // Fecha de guardado ISO válida
    if (
      typeof rec.guardadoEn !== 'string' ||
      rec.guardadoEn.trim().length === 0 ||
      isNaN(Date.parse(rec.guardadoEn))
    ) {
      return false;
    }

    // Respuestas como objeto no nulo ni arreglo
    if (!rec.respuestas || typeof rec.respuestas !== 'object' || Array.isArray(rec.respuestas)) {
      return false;
    }

    // Validación de cada valor en el mapa de respuestas
    for (const [key, val] of Object.entries(rec.respuestas as Record<string, unknown>)) {
      if (typeof key !== 'string') return false;
      const isString = typeof val === 'string';
      const isNumber = typeof val === 'number';
      const isStringArray = Array.isArray(val) && val.every((item) => typeof item === 'string');
      if (!isString && !isNumber && !isStringArray) {
        return false;
      }
    }

    // Coincidencia con valores esperados si se especificaron
    if (expectedPatientId && rec.pacienteId !== expectedPatientId) return false;
    if (expectedFormId && rec.formularioId !== expectedFormId) return false;
    if (expectedVersion && rec.version !== expectedVersion) return false;

    return true;
  } catch {
    return false;
  }
}

const defaultExpoAdapter = new ExpoFileStorageAdapter();

export function getPatientDraftDirectory(pacienteId: string): Directory {
  assertSafeId(pacienteId, 'pacienteId');
  const scoped = scopedClinicalDirectory('formularios_locales', pacienteId);
  return scoped
    ? new Directory(scoped, 'borradores')
    : new Directory(Paths.document, 'formularios_locales', pacienteId, 'borradores');
}

export function getDraftFileName(formularioId: string, version: string): string {
  assertSafeId(formularioId, 'formularioId');
  assertSafeVersion(version, 'version');
  return `${formularioId}_v${version}.json`;
}

/**
 * Guarda o actualiza el borrador de un cuestionario usando el patrón de reemplazo seguro con respaldo:
 * 1. Coordina con withDraftLock (por ruta del borrador) y registra activeDraftWrites para protegerlo de limpiezas concurrentes.
 * 2. Escribe en archivo temporal .tmp.
 * 3. Si el archivo destino .json ya existe, se respalda temporalmente en .bak.
 * 4. Se mueve el .tmp a .json con overwrite = true.
 * 5. Si la operación tiene éxito, se elimina el .bak.
 * 6. Si falla el movimiento, se restaura el .bak a .json para no perder el borrador anterior.
 */
export async function saveFormDraft(
  draft: MedicalFormDraft,
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<void> {
  assertSafeId(draft.pacienteId, 'pacienteId');
  assertSafeId(draft.formularioId, 'formularioId');
  assertSafeVersion(draft.version, 'version');

  const baseDir = baseDirResolver
    ? baseDirResolver(draft.pacienteId)
    : getPatientDraftDirectory(draft.pacienteId).uri;

  await adapter.ensureDirectory(baseDir);

  const baseName = `${draft.formularioId}_v${draft.version}`;
  const sep = baseDir.endsWith('/') ? '' : '/';
  const targetPath = `${baseDir}${sep}${baseName}.json`;
  const bakPath = `${baseDir}${sep}${baseName}.bak`;
  const tmpPath = `${baseDir}${sep}${baseName}.${Date.now()}_${Math.random().toString(36).slice(2, 6)}.tmp`;

  return withDraftLock(targetPath, async () => {
    // Proteger temporal, respaldo y destino de limpiezas o restauraciones concurrentes
    const unregister = registerActiveDraftWrite([tmpPath, bakPath, targetPath]);

    try {
      const payload = JSON.stringify(draft, null, 2);

      // 1. Escribir contenido en temporal
      await adapter.writeText(tmpPath, payload);

      const targetAlreadyExists = await adapter.exists(targetPath);

      // 2. Si el destino existe, crear respaldo .bak obligatorio
      if (targetAlreadyExists) {
        // Si la creación del respaldo falla, se aborta para no comprometer el borrador anterior
        await adapter.moveFile(targetPath, bakPath, { overwrite: true });
      }

      // 3. Mover .tmp a destino
      try {
        await adapter.moveFile(tmpPath, targetPath, { overwrite: true });
        // 4. Éxito: eliminar archivo de respaldo
        if (await adapter.exists(bakPath)) {
          await adapter.deleteFile(bakPath);
        }
      } catch (moveError) {
        // 5. Fallo: restaurar archivo de respaldo si existía
        if (await adapter.exists(bakPath)) {
          try {
            await adapter.moveFile(bakPath, targetPath, { overwrite: true });
          } catch {
            // Fallo de restauración
          }
        }
        if (await adapter.exists(tmpPath)) {
          await adapter.deleteFile(tmpPath);
        }
        throw moveError;
      }
    } finally {
      unregister();
    }
  });
}

/**
 * Escanea y recupera respaldos huérfanos (.bak) si el archivo final (.json) no existe
 * o está corrupto, debido a una interrupción o cierre inesperado durante el guardado.
 * Adquiere el bloqueo por ruta de borrador (withDraftLock) en cada borrador para no interferir con guardados concurrentes.
 */
export async function recoverOrphanDraftBackups(
  baseDir: string,
  adapter: FileStorageAdapter = defaultExpoAdapter,
): Promise<number> {
  const dirExists = adapter.directoryExists
    ? await adapter.directoryExists(baseDir)
    : await adapter.exists(baseDir);
  if (!dirExists) return 0;
  let recovered = 0;
  try {
    const files = await adapter.listDirectory(baseDir);
    for (const fileUri of files) {
      if (fileUri.endsWith('.bak') && !isDraftWriteInFlight(fileUri)) {
        const correspondingJson = fileUri.slice(0, -4) + '.json';
        await withDraftLock(correspondingJson, async () => {
          if (isDraftWriteInFlight(fileUri)) return;

          const jsonExists = await adapter.exists(correspondingJson);

          let jsonValid = false;
          if (jsonExists) {
            try {
              const jsonRaw = await adapter.readText(correspondingJson);
              jsonValid = isValidDraftPayload(jsonRaw);
            } catch {
              jsonValid = false;
            }
          }

          // Si el .json no existe o está corrupto, y el .bak es válido, restaurar el .bak
          if (!jsonExists || !jsonValid) {
            try {
              const bakRaw = await adapter.readText(fileUri);
              if (isValidDraftPayload(bakRaw)) {
                await adapter.moveFile(fileUri, correspondingJson, { overwrite: true });
                recovered++;
              } else {
                // Si tanto .json como .bak están corruptos, eliminar el .bak inservible
                await adapter.deleteFile(fileUri).catch(() => false);
              }
            } catch {
              // Continuar
            }
          } else {
            // El .json existe, es legible y válido: el .bak es un residuo seguro de eliminar
            await adapter.deleteFile(fileUri).catch(() => false);
          }
        });
      }
    }
  } catch {
    // Manejo seguro
  }
  return recovered;
}

/**
 * Recupera el borrador guardado para un paciente, formulario y versión específicos.
 * Si el archivo .json no existe o está corrupto pero se encuentra un respaldo .bak válido,
 * se restaura automáticamente antes de leer.
 */
export async function loadFormDraft(
  pacienteId: string,
  formularioId: string,
  version: string,
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<MedicalFormDraft | null> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(formularioId, 'formularioId');
  assertSafeVersion(version, 'version');

  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientDraftDirectory(pacienteId).uri;

  const sep = baseDir.endsWith('/') ? '' : '/';
  const targetPath = `${baseDir}${sep}${getDraftFileName(formularioId, version)}`;
  const bakPath = `${baseDir}${sep}${formularioId}_v${version}.bak`;

  return withDraftLock(targetPath, async () => {
    let jsonValid = false;
    let loadedDraft: MedicalFormDraft | null = null;

    if (await adapter.exists(targetPath)) {
      try {
        const raw = await adapter.readText(targetPath);
        if (isValidDraftPayload(raw, pacienteId, formularioId, version)) {
          jsonValid = true;
          loadedDraft = JSON.parse(raw) as MedicalFormDraft;
        }
      } catch {
        jsonValid = false;
      }
    }

    // Si el .json no existe o está corrupto, y existe un .bak, intentar recuperarlo
    if (!jsonValid && (await adapter.exists(bakPath))) {
      try {
        const bakRaw = await adapter.readText(bakPath);
        if (isValidDraftPayload(bakRaw, pacienteId, formularioId, version)) {
          await adapter.moveFile(bakPath, targetPath, { overwrite: true });
          return JSON.parse(bakRaw) as MedicalFormDraft;
        }
      } catch {
        // Fallback
      }
    }

    if (jsonValid && loadedDraft) {
      if ((await adapter.exists(bakPath)) && !isDraftWriteInFlight(bakPath)) {
        await adapter.deleteFile(bakPath).catch(() => false);
      }
      return loadedDraft;
    }

    return null;
  });
}

/**
 * Elimina el borrador del almacenamiento local del dispositivo (tanto .json como .bak residual).
 * Requiere que ambos borrados físicos sean exitosos para confirmar el descarte.
 */
export async function deleteFormDraft(
  pacienteId: string,
  formularioId: string,
  version: string,
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<boolean> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(formularioId, 'formularioId');
  assertSafeVersion(version, 'version');

  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientDraftDirectory(pacienteId).uri;

  const sep = baseDir.endsWith('/') ? '' : '/';
  const targetPath = `${baseDir}${sep}${getDraftFileName(formularioId, version)}`;
  const bakPath = `${baseDir}${sep}${formularioId}_v${version}.bak`;

  return withDraftLock(targetPath, async () => {
    let success = true;
    if (await adapter.exists(targetPath)) {
      const deletedJson = await adapter.deleteFile(targetPath);
      if (!deletedJson) {
        success = false;
      }
    }
    if (await adapter.exists(bakPath)) {
      const deletedBak = await adapter.deleteFile(bakPath).catch(() => false);
      if (!deletedBak) {
        success = false;
      }
    }
    return success;
  });
}

/**
 * Lista todos los borradores almacenados localmente para el paciente indicado,
 * recuperando previamente cualquier respaldo huérfano antes de limpiar temporales.
 * Omite la eliminación de temporales pertenecientes a escrituras activas en curso.
 */
export async function listPatientDrafts(
  pacienteId: string,
  adapter: FileStorageAdapter = defaultExpoAdapter,
  baseDirResolver?: (pacienteId: string) => string,
): Promise<MedicalFormDraft[]> {
  assertSafeId(pacienteId, 'pacienteId');

  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientDraftDirectory(pacienteId).uri;

  const dirExists = adapter.directoryExists
    ? await adapter.directoryExists(baseDir)
    : await adapter.exists(baseDir);

  if (!dirExists) return [];

  // Paso 1: Recuperar cualquier respaldo huérfano antes de listar o limpiar
  await recoverOrphanDraftBackups(baseDir, adapter);

  const drafts: MedicalFormDraft[] = [];
  try {
    const files = await adapter.listDirectory(baseDir);
    for (const fileUri of files) {
      // Limpieza de .tmp abandonados (omitiendo escrituras activas)
      if (fileUri.endsWith('.tmp')) {
        if (!isDraftWriteInFlight(fileUri)) {
          await adapter.deleteFile(fileUri).catch(() => false);
        }
        continue;
      }
      if (fileUri.endsWith('.json')) {
        try {
          const raw = await adapter.readText(fileUri);
          if (isValidDraftPayload(raw, pacienteId)) {
            drafts.push(JSON.parse(raw) as MedicalFormDraft);
          }
        } catch {
          // Ignorar archivos JSON corruptos
        }
      }
    }
  } catch {
    return [];
  }
  return drafts;
}
