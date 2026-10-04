import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export function getPatientReportDirectory(pacienteId: string): Directory {
  return new Directory(Paths.document, 'reportes_locales', pacienteId);
}

/**
 * Mueve/copia el PDF generado desde el directorio temporal de la caché
 * hacia el almacenamiento persistente privado del paciente en el dispositivo.
 */
export async function persistReportPdf(
  pacienteId: string,
  tempUri: string,
  periodDays: number,
): Promise<string> {
  const dir = getPatientReportDirectory(pacienteId);
  dir.create({ intermediates: true, idempotent: true });
  const filename = `reporte_${periodDays}d_${Date.now()}.pdf`;
  const targetFile = new File(dir, filename);
  const sourceFile = new File(tempUri);

  await sourceFile.copy(targetFile);

  // Intentar limpiar el archivo temporal de la caché
  try {
    if (sourceFile.exists) {
      sourceFile.delete();
    }
  } catch {
    // Si la caché no permite borrado inmediato, se ignora
  }

  return targetFile.uri;
}

/**
 * Abre el diálogo nativo del sistema operativo para compartir o guardar el PDF generado.
 */
export async function shareReportPdf(pdfUri: string): Promise<boolean> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    return false;
  }
  await Sharing.shareAsync(pdfUri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Compartir reporte de signos vitales (PDF)',
    UTI: 'com.adobe.pdf',
  });
  return true;
}

/**
 * Lista las URIs de los reportes PDF persistidos localmente para el paciente.
 */
export function listPatientReports(pacienteId: string): string[] {
  const dir = getPatientReportDirectory(pacienteId);
  if (!dir.exists) return [];
  try {
    return dir
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.uri.endsWith('.pdf'))
      .map((file) => file.uri);
  } catch {
    return [];
  }
}
