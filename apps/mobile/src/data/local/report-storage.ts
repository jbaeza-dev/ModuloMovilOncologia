import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { assertSafeId } from './resource-storage';

export function assertSafeReportFileName(fileName: string): void {
  if (!fileName || !/^reporte_\d+d_\d+\.pdf$/.test(fileName)) {
    throw new Error(
      `Nombre de archivo de reporte inválido o no seguro: "${fileName}". Formato esperado: reporte_{dias}d_{timestamp}.pdf`,
    );
  }
}

export function parseTimestampFromReportFilename(fileName: string): string | null {
  const match = fileName.match(/^reporte_\d+d_(\d+)\.pdf$/);
  if (!match) return null;
  const ms = Number(match[1]);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export function getPatientReportDirectory(pacienteId: string): Directory {
  assertSafeId(pacienteId, 'pacienteId');
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
): Promise<{ persistentUri: string; filename: string }> {
  assertSafeId(pacienteId, 'pacienteId');
  const dir = getPatientReportDirectory(pacienteId);
  dir.create({ intermediates: true, idempotent: true });
  const filename = `reporte_${periodDays}d_${Date.now()}.pdf`;
  const targetFile = new File(dir, filename);
  const sourceFile = new File(tempUri);

  await sourceFile.copy(targetFile);

  // Intentar limpiar el archivo temporal de la caché
  try {
    if (sourceFile.exists) {
      await sourceFile.delete();
    }
  } catch {
    // Si la caché no permite borrado inmediato, se ignora
  }

  return { persistentUri: targetFile.uri, filename };
}

export type SharePdfResult = 'shared_sheet_opened' | 'sharing_unavailable';

/**
 * Abre el diálogo nativo del sistema operativo para compartir o guardar el PDF generado.
 * La semántica precisa refleja la apertura de la hoja de compartir del sistema,
 * ya que la API de Sharing no acredita si otra aplicación externa recibió o procesó el archivo.
 */
export async function shareReportPdf(pdfUri: string): Promise<SharePdfResult> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return 'sharing_unavailable';
    }
    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Compartir reporte de signos vitales (PDF)',
      UTI: 'com.adobe.pdf',
    });
    return 'shared_sheet_opened';
  } catch {
    return 'sharing_unavailable';
  }
}

/**
 * Lista las URIs de los reportes PDF persistidos localmente para el paciente.
 */
export function listPatientReports(pacienteId: string): string[] {
  assertSafeId(pacienteId, 'pacienteId');
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
