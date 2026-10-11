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

export function parsePeriodFromReportFilename(fileName: string): number | null {
  const match = fileName.match(/^reporte_(\d+)d_\d+\.pdf$/);
  if (!match) return null;
  const days = Number(match[1]);
  if (Number.isNaN(days)) return null;
  return days;
}

export function getPatientReportDirectory(pacienteId: string): Directory {
  assertSafeId(pacienteId, 'pacienteId');
  return new Directory(Paths.document, 'reportes_locales', pacienteId);
}

export interface PatientReportItem {
  uri: string;
  filename: string;
  periodDays: number | null;
  generatedAt: string | null;
  sizeBytes: number | null;
}

/**
 * Registro de archivos de reportes antiguos cuya eliminación inmediata falló
 * tras haberse guardado con éxito el nuevo reporte. Permite conservar ambos archivos
 * y rastrear limpiezas pendientes sin comprometer la integridad.
 */
const pendingReportCleanups = new Set<string>();

export function getPendingReportCleanups(): string[] {
  return Array.from(pendingReportCleanups);
}

export function registerPendingReportCleanup(fileUri: string): void {
  pendingReportCleanups.add(fileUri);
}

export function clearPendingReportCleanups(): void {
  pendingReportCleanups.clear();
}

export async function flushPendingReportCleanups(): Promise<number> {
  let cleaned = 0;
  for (const uri of Array.from(pendingReportCleanups)) {
    try {
      const file = new File(uri);
      if (file.exists) {
        await file.delete();
      }
      pendingReportCleanups.delete(uri);
      cleaned++;
    } catch {
      // Permanece pendiente
    }
  }
  return cleaned;
}

/**
 * Mueve/copia el PDF generado desde el directorio temporal de la caché
 * hacia el almacenamiento persistente privado del paciente en el dispositivo:
 * 1. Copia y asegura el nuevo archivo PDF primero antes de borrar cualquier archivo anterior.
 * 2. Si la copia falla, conserva intacto el reporte anterior.
 * 3. Solo tras verificar que el nuevo archivo existe, procede a limpiar el reporte anterior del mismo período.
 * 4. Si la limpieza posterior falla, conserva ambos archivos y registra la URI en limpiezas pendientes.
 */
export async function persistReportPdf(
  pacienteId: string,
  tempUri: string,
  periodDays: number,
): Promise<{ persistentUri: string; filename: string }> {
  assertSafeId(pacienteId, 'pacienteId');
  const dir = getPatientReportDirectory(pacienteId);
  dir.create({ intermediates: true, idempotent: true });

  // 1. Identificar reportes previos para el MISMO período sin borrarlos todavía
  const previousReportFiles: File[] = [];
  try {
    const existingEntries = dir.list();
    for (const entry of existingEntries) {
      if (entry instanceof File && entry.uri.endsWith('.pdf')) {
        const name = entry.name ?? Paths.basename(entry.uri);
        if (name.startsWith(`reporte_${periodDays}d_`)) {
          previousReportFiles.push(entry);
        }
      }
    }
  } catch {
    // Si la lectura previa no está disponible, continuar
  }

  // 2. Garantizar un destino exclusivo para cada guardado. Si ya existe, elegir otro nombre o abortar sin tocarlo.
  let timestamp = Date.now();
  let filename = `reporte_${periodDays}d_${timestamp}.pdf`;
  let targetFile = new File(dir, filename);

  let attempts = 0;
  while (targetFile.exists && attempts < 1000) {
    timestamp++;
    filename = `reporte_${periodDays}d_${timestamp}.pdf`;
    targetFile = new File(dir, filename);
    attempts++;
  }

  const targetExistedBefore = targetFile.exists;
  if (targetExistedBefore) {
    throw new Error(
      `No se pudo encontrar un nombre de destino exclusivo para el reporte tras múltiples intentos.`,
    );
  }

  const sourceFile = new File(tempUri);

  // 3. Guardar y verificar el PDF nuevo PRIMERO.
  // Limpiar ante errores ÚNICAMENTE archivos creados por esta operación (nunca archivos preexistentes).
  try {
    await sourceFile.copy(targetFile);
  } catch (copyError) {
    if (!targetExistedBefore) {
      try {
        if (targetFile.exists) {
          await targetFile.delete();
        }
      } catch {
        // Ignorar fallo de borrado del residuo parcial
      }
    }
    throw copyError;
  }

  if (!targetFile.exists) {
    throw new Error(
      `Fallo al persistir reporte PDF: el archivo "${filename}" no existe tras la copia.`,
    );
  }

  // 3. Ya asegurado el PDF nuevo, limpiar los reportes anteriores del mismo período
  for (const prev of previousReportFiles) {
    if (prev.uri === targetFile.uri) continue;
    try {
      if (prev.exists) {
        await prev.delete();
      }
    } catch {
      // 4. Si falla la limpieza posterior: conservar ambos archivos y registrar la limpieza pendiente
      registerPendingReportCleanup(prev.uri);
    }
  }

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

/**
 * Lista los metadatos completos de los reportes PDF persistidos localmente para el paciente,
 * ordenados de más reciente a más antiguo.
 */
export function getPatientReportList(pacienteId: string): PatientReportItem[] {
  assertSafeId(pacienteId, 'pacienteId');
  const dir = getPatientReportDirectory(pacienteId);
  if (!dir.exists) return [];
  try {
    const entries = dir.list();
    const reports: PatientReportItem[] = [];
    for (const entry of entries) {
      if (entry instanceof File && entry.uri.endsWith('.pdf')) {
        const filename = entry.name ?? Paths.basename(entry.uri);
        if (filename && /^reporte_\d+d_\d+\.pdf$/.test(filename)) {
          const periodDays = parsePeriodFromReportFilename(filename);
          const generatedAt = parseTimestampFromReportFilename(filename);
          const sizeBytes = entry.size ?? null;
          reports.push({
            uri: entry.uri,
            filename,
            periodDays,
            generatedAt,
            sizeBytes,
          });
        }
      }
    }
    reports.sort((a, b) => {
      const timeA = a.generatedAt ? Date.parse(a.generatedAt) : 0;
      const timeB = b.generatedAt ? Date.parse(b.generatedAt) : 0;
      return timeB - timeA;
    });
    return reports;
  } catch {
    return [];
  }
}

/**
 * Elimina un reporte PDF específico del paciente activo.
 */
export async function deletePatientReport(pacienteId: string, fileName: string): Promise<boolean> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeReportFileName(fileName);
  const dir = getPatientReportDirectory(pacienteId);
  if (!dir.exists) return false;
  try {
    const targetFile = new File(dir, fileName);
    if (targetFile.exists) {
      await targetFile.delete();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
