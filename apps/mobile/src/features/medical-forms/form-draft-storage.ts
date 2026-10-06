import { Directory, Paths } from 'expo-file-system';

import {
  ExpoFileStorageAdapter,
  type FileStorageAdapter,
} from '../../data/local/file-storage-adapter';
import { assertSafeId, assertSafeVersion } from '../../data/local/resource-storage';
import type { MedicalFormDraft } from './medical-form-types';

const defaultExpoAdapter = new ExpoFileStorageAdapter();

export function getPatientDraftDirectory(pacienteId: string): Directory {
  assertSafeId(pacienteId, 'pacienteId');
  return new Directory(Paths.document, 'formularios_locales', pacienteId, 'borradores');
}

export function getDraftFileName(formularioId: string, version: string): string {
  assertSafeId(formularioId, 'formularioId');
  assertSafeVersion(version, 'version');
  return `${formularioId}_v${version}.json`;
}

/**
 * Guarda o actualiza el borrador de un cuestionario usando el patrón de reemplazo seguro con respaldo:
 * 1. Escribe en archivo temporal .tmp.
 * 2. Si el archivo destino .json ya existe, se respalda temporalmente en .bak.
 * 3. Se mueve el .tmp a .json con overwrite = true.
 * 4. Si la operación tiene éxito, se elimina el .bak.
 * 5. Si falla el movimiento, se restaura el .bak a .json para no perder el borrador anterior.
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
}

/**
 * Escanea y recupera respaldos huérfanos (.bak) si el archivo final (.json) no existe
 * debido a una interrupción o cierre inesperado durante el guardado.
 */
export async function recoverOrphanDraftBackups(
  baseDir: string,
  adapter: FileStorageAdapter = defaultExpoAdapter,
): Promise<number> {
  if (!(await adapter.exists(baseDir))) return 0;
  let recovered = 0;
  try {
    const files = await adapter.listDirectory(baseDir);
    for (const fileUri of files) {
      if (fileUri.endsWith('.bak')) {
        const correspondingJson = fileUri.slice(0, -4) + '.json';
        const jsonExists = await adapter.exists(correspondingJson);
        if (!jsonExists) {
          try {
            await adapter.moveFile(fileUri, correspondingJson, { overwrite: true });
            recovered++;
          } catch {
            // Continuar
          }
        } else {
          // El .json existe y está confirmado: el .bak es un residuo
          await adapter.deleteFile(fileUri).catch(() => false);
        }
      }
    }
  } catch {
    // Manejo seguro
  }
  return recovered;
}

/**
 * Recupera el borrador guardado para un paciente, formulario y versión específicos.
 * Si el archivo .json no existe pero se encuentra un respaldo .bak huérfano,
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

  // Recuperación automática de respaldo si la aplicación cerró entre el movimiento a .bak y a .json
  if (!(await adapter.exists(targetPath)) && (await adapter.exists(bakPath))) {
    try {
      await adapter.moveFile(bakPath, targetPath, { overwrite: true });
    } catch {
      // Fallback: intentar leer del .bak directamente
      try {
        const raw = await adapter.readText(bakPath);
        return JSON.parse(raw) as MedicalFormDraft;
      } catch {
        return null;
      }
    }
  }

  if (!(await adapter.exists(targetPath))) return null;

  try {
    const raw = await adapter.readText(targetPath);
    return JSON.parse(raw) as MedicalFormDraft;
  } catch {
    return null;
  }
}

/**
 * Elimina el borrador del almacenamiento local del dispositivo (incluyendo .bak residual).
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

  let success = true;
  if (await adapter.exists(targetPath)) {
    success = await adapter.deleteFile(targetPath);
  }
  if (await adapter.exists(bakPath)) {
    await adapter.deleteFile(bakPath).catch(() => false);
  }
  return success;
}

/**
 * Lista todos los borradores almacenados localmente para el paciente indicado,
 * recuperando previamente cualquier respaldo huérfano antes de limpiar temporales.
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

  if (!(await adapter.exists(baseDir))) return [];

  // Paso 1: Recuperar cualquier respaldo huérfano antes de listar o limpiar
  await recoverOrphanDraftBackups(baseDir, adapter);

  const drafts: MedicalFormDraft[] = [];
  try {
    const files = await adapter.listDirectory(baseDir);
    for (const fileUri of files) {
      // Limpieza de .tmp abandonados
      if (fileUri.endsWith('.tmp')) {
        await adapter.deleteFile(fileUri).catch(() => false);
        continue;
      }
      if (fileUri.endsWith('.json')) {
        try {
          const raw = await adapter.readText(fileUri);
          const parsed = JSON.parse(raw) as MedicalFormDraft;
          // Validar que pertenezca al paciente
          if (parsed && parsed.pacienteId === pacienteId) {
            drafts.push(parsed);
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
