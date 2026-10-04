import { Directory, File, Paths } from 'expo-file-system';

import type { MedicalFormDraft } from './medical-form-types';

export function getPatientDraftDirectory(pacienteId: string): Directory {
  return new Directory(Paths.document, 'formularios_locales', pacienteId, 'borradores');
}

function getDraftFileName(formularioId: string, version: string): string {
  const safeId = formularioId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safeId}_v${safeVersion}.json`;
}

/**
 * Guarda o actualiza el borrador del cuestionario médico en el almacenamiento local aislado del paciente.
 */
export async function saveFormDraft(draft: MedicalFormDraft): Promise<void> {
  const dir = getPatientDraftDirectory(draft.pacienteId);
  dir.create({ intermediates: true, idempotent: true });
  const filename = getDraftFileName(draft.formularioId, draft.version);
  const file = new File(dir, filename);
  file.write(JSON.stringify(draft, null, 2));
}

/**
 * Recupera el borrador guardado para un paciente, formulario y versión específicos.
 */
export async function loadFormDraft(
  pacienteId: string,
  formularioId: string,
  version: string,
): Promise<MedicalFormDraft | null> {
  const dir = getPatientDraftDirectory(pacienteId);
  if (!dir.exists) return null;
  const filename = getDraftFileName(formularioId, version);
  const file = new File(dir, filename);
  if (!file.exists) return null;
  try {
    const raw = await file.text();
    return JSON.parse(raw) as MedicalFormDraft;
  } catch {
    return null;
  }
}

/**
 * Elimina el borrador del almacenamiento local del dispositivo.
 */
export async function deleteFormDraft(
  pacienteId: string,
  formularioId: string,
  version: string,
): Promise<void> {
  const dir = getPatientDraftDirectory(pacienteId);
  if (!dir.exists) return;
  const filename = getDraftFileName(formularioId, version);
  const file = new File(dir, filename);
  if (file.exists) {
    try {
      file.delete();
    } catch {
      // Manejo seguro ante error de borrado
    }
  }
}

/**
 * Lista todos los borradores almacenados localmente para el paciente indicado.
 */
export async function listPatientDrafts(pacienteId: string): Promise<MedicalFormDraft[]> {
  const dir = getPatientDraftDirectory(pacienteId);
  if (!dir.exists) return [];
  try {
    const drafts: MedicalFormDraft[] = [];
    const entries = dir.list();
    for (const entry of entries) {
      if (entry instanceof File && entry.uri.endsWith('.json')) {
        try {
          const raw = await entry.text();
          drafts.push(JSON.parse(raw) as MedicalFormDraft);
        } catch {
          // Ignorar archivos corruptos
        }
      }
    }
    return drafts;
  } catch {
    return [];
  }
}
