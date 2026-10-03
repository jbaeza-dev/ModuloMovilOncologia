import { Directory, File, Paths } from 'expo-file-system';

export function getPatientResourceDirectory(pacienteId: string): Directory {
  return new Directory(Paths.document, 'recursos_educativos', pacienteId);
}

export function getResourceFile(pacienteId: string, contenidoId: string): File {
  const dir = getPatientResourceDirectory(pacienteId);
  return new File(dir, `${contenidoId}.md`);
}

export async function writeResourceFile(
  pacienteId: string,
  contenidoId: string,
  content: string,
): Promise<string> {
  const dir = getPatientResourceDirectory(pacienteId);
  dir.create({ intermediates: true, idempotent: true });
  const file = getResourceFile(pacienteId, contenidoId);
  file.write(content);
  return file.uri;
}

export async function deleteResourceFile(pacienteId: string, contenidoId: string): Promise<void> {
  const file = getResourceFile(pacienteId, contenidoId);
  if (file.exists) {
    file.delete();
  }
}

export function resourceFileExists(pacienteId: string, contenidoId: string): boolean {
  return getResourceFile(pacienteId, contenidoId).exists;
}

export async function readResourceFile(
  pacienteId: string,
  contenidoId: string,
): Promise<string | null> {
  const file = getResourceFile(pacienteId, contenidoId);
  if (!file.exists) return null;
  return file.text();
}
