import { scopedClinicalDirectory } from '../../sync/file-protection';
import { clinicalFileLease } from '../../sync/file-protection';
import {
  protectClinicalFile,
  readClinicalFile,
  assertClinicalFileContext,
  isClinicalFile,
} from '../../sync/file-protection';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { assertSafeId } from './resource-storage';

export type ReportFileFormat = 'pdf' | 'xlsx';

const REPORT_FILENAME_REGEX = /^reporte_(\d+)d(?:_([a-zA-Z0-9_-]+))?_(\d+)\.(pdf|xlsx)$/i;

export function assertSafeReportFileName(fileName: string): void {
  if (!fileName || !REPORT_FILENAME_REGEX.test(fileName)) {
    throw new Error(
      `Nombre de archivo de reporte inválido o no seguro: "${fileName}". Formato esperado: reporte_{dias}d_{timestamp}.(pdf|xlsx) o reporte_{dias}d_{nombre}_{timestamp}.(pdf|xlsx)`,
    );
  }
}

export function parseTimestampFromReportFilename(fileName: string): string | null {
  const match = fileName.match(REPORT_FILENAME_REGEX);
  if (!match) return null;
  const ms = Number(match[3]);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function parsePeriodFromReportFilename(fileName: string): number | null {
  const match = fileName.match(REPORT_FILENAME_REGEX);
  if (!match) return null;
  const days = Number(match[1]);
  if (days !== 7 && days !== 30 && days !== 90 && days !== 365) return null;
  return days;
}

export function parseFormatFromReportFilename(fileName: string): ReportFileFormat | null {
  const match = fileName.match(REPORT_FILENAME_REGEX);
  if (!match) return null;
  return (match[4].toLowerCase() as ReportFileFormat) ?? null;
}

export function getPatientReportDirectory(pacienteId: string): Directory {
  assertSafeId(pacienteId, 'pacienteId');
  const scoped = scopedClinicalDirectory('reportes_locales', pacienteId);
  return scoped
    ? new Directory(scoped)
    : new Directory(Paths.document, 'reportes_locales', pacienteId);
}

/**
 * Resuelve de forma segura un archivo de reporte dentro del directorio exclusivo
 * del paciente activo. Valida el nombre de archivo y rechaza cualquier URI que
 * apunte a otro paciente o fuera de la carpeta canónica.
 */
export function resolvePatientReportFile(
  pacienteId: string,
  params: { filename?: string; uri?: string },
): { file: File; filename: string; canonicalUri: string } {
  assertSafeId(pacienteId, 'pacienteId');
  if (params.uri) {
    const uriOwner = extractPatientIdFromReportUri(params.uri);
    if (uriOwner && uriOwner !== pacienteId) {
      throw new Error('El reporte solicitado pertenece a otro paciente.');
    }
    if (params.uri.includes('..')) {
      throw new Error('Ruta de archivo de reporte inválida.');
    }
  }
  const candidateFilename =
    params.filename || (params.uri ? (Paths.basename(params.uri) ?? '') : '');
  assertSafeReportFileName(candidateFilename);
  const dir = getPatientReportDirectory(pacienteId);
  const canonicalUri = `${dir.uri}/${candidateFilename}`;
  const file = new File(canonicalUri);
  return {
    file,
    filename: candidateFilename,
    canonicalUri: file.uri ?? canonicalUri,
  };
}

export interface PatientReportItem {
  uri: string;
  filename: string;
  format: ReportFileFormat;
  periodDays: number | null;
  generatedAt: string | null;
  sizeBytes: number | null;
}

/**
 * Adaptador abstracto de almacenamiento binario para desacoplar operaciones de sistema
 * de archivos de la lógica de negocio y permitir pruebas de integración y simulación de fallos.
 */
export interface BinaryReportStorageAdapter {
  writeBytes(fileUri: string, bytes: Uint8Array): Promise<number | void>;
  copyFile(sourceUri: string, targetUri: string): Promise<void>;
  moveFile(sourceUri: string, targetUri: string): Promise<void>;
  deleteFile(fileUri: string): Promise<void>;
  fileExists(fileUri: string): Promise<boolean>;
  directoryExists(dirUri: string): Promise<boolean>;
  getFileSize(fileUri: string): Promise<number | null>;
  ensureDirectory(dirUri: string): Promise<void>;
  listDirectory(
    dirUri: string,
  ): Promise<Array<{ uri: string; name: string; isFile: boolean; size: number | null }>>;
}

export class ExpoBinaryReportStorageAdapter implements BinaryReportStorageAdapter {
  async writeBytes(fileUri: string, bytes: Uint8Array): Promise<number> {
    const file = new File(fileUri);
    const protectedBytes = await protectClinicalFile(fileUri, bytes);
    await file.write(protectedBytes);
    return protectedBytes.byteLength;
  }

  async copyFile(sourceUri: string, targetUri: string): Promise<void> {
    const source = new File(sourceUri);
    const target = new File(targetUri);
    await target.write(
      await protectClinicalFile(targetUri, await readClinicalFile(sourceUri, await source.bytes())),
    );
  }

  async moveFile(sourceUri: string, targetUri: string): Promise<void> {
    assertClinicalFileContext(sourceUri);
    assertClinicalFileContext(targetUri);
    const source = new File(sourceUri);
    const target = new File(targetUri);
    await source.move(target);
  }

  async deleteFile(fileUri: string): Promise<void> {
    const file = new File(fileUri);
    if (file.exists) {
      await file.delete();
    }
  }

  async fileExists(fileUri: string): Promise<boolean> {
    const file = new File(fileUri);
    return file.exists;
  }

  async directoryExists(dirUri: string): Promise<boolean> {
    const dir = new Directory(dirUri);
    return dir.exists;
  }

  async getFileSize(fileUri: string): Promise<number | null> {
    const file = new File(fileUri);
    return file.exists ? (file.size ?? null) : null;
  }

  async ensureDirectory(dirUri: string): Promise<void> {
    const dir = new Directory(dirUri);
    dir.create({ intermediates: true, idempotent: true });
  }

  async listDirectory(
    dirUri: string,
  ): Promise<Array<{ uri: string; name: string; isFile: boolean; size: number | null }>> {
    const dir = new Directory(dirUri);
    if (!dir.exists) return [];
    const entries = dir.list();
    return entries.map((entry) => ({
      uri: entry.uri,
      name: entry.name ?? Paths.basename(entry.uri),
      isFile: entry instanceof File,
      size: entry instanceof File ? (entry.size ?? null) : null,
    }));
  }
}

const defaultAdapter = new ExpoBinaryReportStorageAdapter();

/**
 * Bloqueo de almacenamiento por paciente para serializar selección de nombre,
 * publicación y reemplazo de archivos, impidiendo colisiones y sobreescrituras concurrentes.
 */
const patientReportLocks = new Map<string, Promise<unknown>>();

export async function withPatientReportLock<T>(
  pacienteId: string,
  work: () => Promise<T>,
): Promise<T> {
  const currentLock = patientReportLocks.get(pacienteId) ?? Promise.resolve();
  let release: () => void = () => {};
  const nextLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  patientReportLocks.set(pacienteId, nextLock);
  await currentLock;
  try {
    return await work();
  } finally {
    release();
    if (patientReportLocks.get(pacienteId) === nextLock) {
      patientReportLocks.delete(pacienteId);
    }
  }
}

export function extractPatientIdFromReportUri(uri: string): string | null {
  const match = uri.match(/[/\\]reportes_locales[/\\](?:[0-9a-f]{24}[/\\])?([^/\\]+)[/\\]/);
  return match ? match[1] : null;
}

interface PendingCleanupItem {
  uri: string;
  pacienteId?: string;
}

/**
 * Registro de archivos de reportes antiguos cuya eliminación inmediata falló.
 * Se conserva en memoria durante la sesión activa con su paciente asociado para coordinar bloqueos.
 */
const pendingReportCleanups = new Map<string, PendingCleanupItem>();

export function getPendingReportCleanups(): string[] {
  return Array.from(pendingReportCleanups.keys());
}

export function registerPendingReportCleanup(fileUri: string, pacienteId?: string): void {
  const resolvedPatientId = pacienteId ?? extractPatientIdFromReportUri(fileUri) ?? undefined;
  pendingReportCleanups.set(fileUri, { uri: fileUri, pacienteId: resolvedPatientId });
}

export function clearPendingReportCleanups(): void {
  pendingReportCleanups.clear();
}

/**
 * Ejecuta la eliminación de reportes pendientes.
 * Si se especifica `heldLockPatientId`, procesa EXCLUSIVAMENTE los pendientes de ese paciente,
 * sin intentar adquirir bloqueos de otros pacientes para prevenir deadlocks cruzados (A/B).
 * Si no se especifica (invocación global), agrupa los pendientes por paciente
 * y procesa un paciente a la vez bajo su bloqueo correspondiente de forma estrictamente serializada.
 */
export async function flushPendingReportCleanups(
  adapter: BinaryReportStorageAdapter = defaultAdapter,
  heldLockPatientId?: string,
): Promise<number> {
  let cleaned = 0;
  if (heldLockPatientId) {
    const patientEntries = Array.from(pendingReportCleanups.values()).filter(
      (e) => e.pacienteId === heldLockPatientId,
    );
    for (const entry of patientEntries) {
      try {
        if (await adapter.fileExists(entry.uri)) {
          await adapter.deleteFile(entry.uri);
        }
        pendingReportCleanups.delete(entry.uri);
        cleaned++;
      } catch {
        // Permanece pendiente para el próximo reintento
      }
    }
    return cleaned;
  }

  // Invocación global: agrupar por paciente y procesar un paciente a la vez
  const entries = Array.from(pendingReportCleanups.values());
  const byPatient = new Map<string, PendingCleanupItem[]>();
  const unassigned: PendingCleanupItem[] = [];

  for (const entry of entries) {
    if (entry.pacienteId) {
      const list = byPatient.get(entry.pacienteId) ?? [];
      list.push(entry);
      byPatient.set(entry.pacienteId, list);
    } else {
      unassigned.push(entry);
    }
  }

  const sortedPatientIds = Array.from(byPatient.keys()).sort();
  for (const pid of sortedPatientIds) {
    const pEntries = byPatient.get(pid)!;
    await withPatientReportLock(pid, async () => {
      for (const entry of pEntries) {
        try {
          if (await adapter.fileExists(entry.uri)) {
            await adapter.deleteFile(entry.uri);
          }
          pendingReportCleanups.delete(entry.uri);
          cleaned++;
        } catch {
          // Permanece pendiente
        }
      }
    });
  }

  for (const entry of unassigned) {
    try {
      if (await adapter.fileExists(entry.uri)) {
        await adapter.deleteFile(entry.uri);
      }
      pendingReportCleanups.delete(entry.uri);
      cleaned++;
    } catch {
      // Permanece pendiente
    }
  }

  return cleaned;
}

/**
 * Helper interno que ejecuta la limpieza de temporales huérfanos asumiendo
 * que el invocador ya retiene el bloqueo de almacenamiento del paciente.
 */
async function cleanOrphanedTempReportsInternal(
  pacienteId: string,
  adapter: BinaryReportStorageAdapter,
): Promise<number> {
  assertSafeId(pacienteId, 'pacienteId');
  const dir = getPatientReportDirectory(pacienteId);
  if (!(await adapter.directoryExists(dir.uri))) return 0;
  let cleaned = 0;
  try {
    const entries = await adapter.listDirectory(dir.uri);
    for (const entry of entries) {
      if (entry.isFile && entry.name && entry.name.startsWith('.tmp_reporte_')) {
        try {
          await adapter.deleteFile(entry.uri);
          cleaned++;
        } catch {
          // Ignorar fallo puntual
        }
      }
    }
  } catch {
    // Si falla el listado, retornar los limpiados hasta el momento
  }
  return cleaned;
}

/**
 * Limpia archivos temporales (.tmp_reporte_*) que hayan quedado huérfanos
 * tras un fallo catastrófico o cierre abrupto de la aplicación. Adquiere
 * de forma segura el bloqueo exclusivo del paciente (`withPatientReportLock`).
 */
export async function cleanOrphanedTempReports(
  pacienteId: string,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
): Promise<number> {
  assertSafeId(pacienteId, 'pacienteId');
  return withPatientReportLock(pacienteId, async () => {
    return cleanOrphanedTempReportsInternal(pacienteId, adapter);
  });
}

export type ReportFileSource =
  | { type: 'temp_uri'; tempUri: string }
  | { type: 'bytes'; bytes: Uint8Array };

/**
 * Persiste de forma segura un reporte (PDF o XLSX) para el paciente activo:
 * 1. Serializado mediante bloqueo por paciente (withPatientReportLock).
 * 2. Escribe primero en un temporal exclusivo (.tmp).
 * 3. Verifica existencia y coincidencia exacta de tamaño del temporal.
 * 4. Determina un nombre de destino final exclusivo libre de colisiones.
 * 5. Publica atómicamente moviendo el temporal al destino final.
 * 6. Verifica la existencia y tamaño del archivo final publicado.
 * 7. Si falla la verificación post-publicación, elimina el destino recién creado y conserva el anterior.
 * 8. Una vez confirmado el nuevo archivo, limpia únicamente los reportes previos del MISMO paciente, MISMO período y MISMO formato.
 */
export async function persistReportFile(
  pacienteId: string,
  source: ReportFileSource,
  periodDays: number,
  format: ReportFileFormat,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
  a11ySnapshot?: unknown,
  patientName?: string,
): Promise<{ persistentUri: string; filename: string }> {
  assertSafeId(pacienteId, 'pacienteId');
  if (periodDays !== 7 && periodDays !== 30 && periodDays !== 90 && periodDays !== 365) {
    throw new Error(`Período de reporte no admitido: ${periodDays} días.`);
  }

  return withPatientReportLock(pacienteId, async () => {
    // Reintento oportuno de limpiezas previas y temporales huérfanos sin cruce entre pacientes
    await cleanOrphanedTempReportsInternal(pacienteId, adapter);
    await flushPendingReportCleanups(adapter, pacienteId);

    const dir = getPatientReportDirectory(pacienteId);
    await adapter.ensureDirectory(dir.uri);

    // Identificar reportes previos para el MISMO período y MISMO formato
    const existingEntries = await adapter.listDirectory(dir.uri);
    const previousMatchingReportUris: string[] = [];
    for (const entry of existingEntries) {
      if (entry.isFile && entry.name) {
        const p = parsePeriodFromReportFilename(entry.name);
        const f = parseFormatFromReportFilename(entry.name);
        if (p === periodDays && f === format) {
          previousMatchingReportUris.push(entry.uri);
        }
      }
    }

    // Escribir primero en un archivo temporal exclusivo
    const randSuffix = Math.random().toString(36).slice(2, 8);
    const tempFilename = `.tmp_reporte_${periodDays}d_${Date.now()}_${randSuffix}.${format}`;
    const tempFileUri = `${dir.uri}/${tempFilename}`;
    const tempA11yFilename = a11ySnapshot ? `${tempFilename}.a11y.json.tmp` : null;
    const tempA11yFileUri = tempA11yFilename ? `${dir.uri}/${tempA11yFilename}` : null;

    let tempMovedToTarget = false;
    let publishedTargetUri: string | null = null;
    let expectedByteLength = source.type === 'bytes' ? source.bytes.length : 0;

    try {
      if (source.type === 'bytes') {
        const writtenLength = await adapter.writeBytes(tempFileUri, source.bytes);
        if (typeof writtenLength === 'number' && writtenLength > 0) {
          expectedByteLength = writtenLength;
        }
      } else {
        await adapter.copyFile(source.tempUri, tempFileUri);
      }

      if (a11ySnapshot && tempA11yFileUri) {
        const a11yBytes = new TextEncoder().encode(JSON.stringify(a11ySnapshot));
        await adapter.writeBytes(tempA11yFileUri, a11yBytes);
      }

      // Verificación del archivo temporal
      const tempExists = await adapter.fileExists(tempFileUri);
      if (!tempExists) {
        throw new Error(
          'Fallo de almacenamiento: el archivo temporal no existe tras la escritura.',
        );
      }
      const tempSize = await adapter.getFileSize(tempFileUri);
      if (source.type === 'bytes') {
        if (tempSize !== expectedByteLength) {
          throw new Error(
            `Fallo de verificación: tamaño de archivo temporal (${tempSize}) no coincide con los bytes generados (${expectedByteLength}).`,
          );
        }
      } else {
        if (!tempSize || tempSize <= 0) {
          throw new Error(
            `Fallo de verificación: tamaño de archivo temporal inválido (${tempSize}).`,
          );
        }
      }

      if (tempA11yFileUri) {
        const a11yExists = await adapter.fileExists(tempA11yFileUri);
        const a11ySize = await adapter.getFileSize(tempA11yFileUri);
        if (!a11yExists || a11ySize === null || a11ySize <= 0) {
          throw new Error(
            'Fallo de almacenamiento: el archivo temporal de accesibilidad no pudo confirmarse.',
          );
        }
      }

      // Selección de nombre de destino final exclusivo dentro del bloqueo
      let sanitizedName = '';
      if (typeof patientName === 'string' && patientName.trim()) {
        sanitizedName = patientName
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9_-]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 30);
      }
      const dateIso = new Date().toISOString().slice(0, 10);
      const namePart = sanitizedName ? `_${sanitizedName}_${dateIso}` : '';
      let timestamp = Date.now();
      let filename = `reporte_${periodDays}d${namePart}_${timestamp}.${format}`;
      let targetFileUri = `${dir.uri}/${filename}`;

      let attempts = 0;
      while ((await adapter.fileExists(targetFileUri)) && attempts < 1000) {
        timestamp++;
        filename = `reporte_${periodDays}d${namePart}_${timestamp}.${format}`;
        targetFileUri = `${dir.uri}/${filename}`;
        attempts++;
      }

      if (await adapter.fileExists(targetFileUri)) {
        throw new Error(
          'No se pudo encontrar un nombre de destino exclusivo para el reporte tras múltiples intentos.',
        );
      }

      // Publicación atómica
      await adapter.moveFile(tempFileUri, targetFileUri);
      tempMovedToTarget = true;
      publishedTargetUri = targetFileUri;
      if (tempA11yFileUri) {
        const targetA11yUri = `${targetFileUri}.a11y.json`;
        await adapter.moveFile(tempA11yFileUri, targetA11yUri);
      }

      // Verificación post-publicación
      let finalVerified = false;
      try {
        const targetExists = await adapter.fileExists(targetFileUri);
        const targetSize = await adapter.getFileSize(targetFileUri);
        if (targetExists && targetSize !== null && targetSize > 0) {
          if (source.type === 'bytes' && targetSize !== expectedByteLength) {
            finalVerified = false;
          } else {
            finalVerified = true;
          }
        }
        if (finalVerified && tempA11yFileUri) {
          const targetA11yUri = `${targetFileUri}.a11y.json`;
          const a11yOk =
            (await adapter.fileExists(targetA11yUri)) &&
            ((await adapter.getFileSize(targetA11yUri)) ?? 0) > 0;
          if (!a11yOk) finalVerified = false;
        }
      } catch {
        finalVerified = false;
      }

      if (!finalVerified) {
        // Limpiar el destino corrupto recién creado por esta operación
        try {
          if (await adapter.fileExists(targetFileUri)) {
            await adapter.deleteFile(targetFileUri);
          }
        } catch {
          // Ignorar fallo al limpiar residuo
        }
        publishedTargetUri = null;
        throw new Error(
          `Fallo de verificación post-publicación: el archivo final "${filename}" no pudo confirmarse.`,
        );
      }

      // Ya confirmado el nuevo reporte, limpiar los anteriores del MISMO período y formato
      for (const prevUri of previousMatchingReportUris) {
        if (prevUri === targetFileUri) continue;
        try {
          if (await adapter.fileExists(prevUri)) {
            await adapter.deleteFile(prevUri);
          }
          const prevA11y = `${prevUri}.a11y.json`;
          if (await adapter.fileExists(prevA11y)) {
            await adapter.deleteFile(prevA11y);
          }
        } catch {
          registerPendingReportCleanup(prevUri, pacienteId);
        }
      }

      // Limpiar archivo temporal externo si la fuente era temp_uri
      if (source.type === 'temp_uri') {
        try {
          if (await adapter.fileExists(source.tempUri)) {
            await adapter.deleteFile(source.tempUri);
          }
        } catch {
          // Ignorar borrado de caché
        }
      }

      return { persistentUri: targetFileUri, filename };
    } catch (error) {
      // Limpiar archivo temporal si no fue trasladado y existe (incluso tras escritura parcial)
      if (!tempMovedToTarget) {
        try {
          if (await adapter.fileExists(tempFileUri)) {
            await adapter.deleteFile(tempFileUri);
          }
        } catch {
          // Ignorar fallo al limpiar temporal
        }
      }
      if (tempA11yFileUri) {
        try {
          if (await adapter.fileExists(tempA11yFileUri)) {
            await adapter.deleteFile(tempA11yFileUri);
          }
        } catch {
          /* safe non-blocking cleanup */
        }
      }
      if (publishedTargetUri) {
        try {
          const pubA11y = `${publishedTargetUri}.a11y.json`;
          if (await adapter.fileExists(pubA11y)) {
            await adapter.deleteFile(pubA11y);
          }
        } catch {
          /* safe non-blocking cleanup */
        }
      }
      // Limpiar destino publicado si quedó a medio verificar
      if (publishedTargetUri) {
        try {
          if (await adapter.fileExists(publishedTargetUri)) {
            await adapter.deleteFile(publishedTargetUri);
          }
        } catch {
          // Ignorar fallo al limpiar destino corrupto
        }
      }
      throw error;
    }
  });
}

export async function persistReportPdf(
  pacienteId: string,
  tempUri: string,
  periodDays: number,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
  a11ySnapshot?: unknown,
  patientName?: string,
): Promise<{ persistentUri: string; filename: string }> {
  return persistReportFile(
    pacienteId,
    { type: 'temp_uri', tempUri },
    periodDays,
    'pdf',
    adapter,
    a11ySnapshot,
    patientName,
  );
}

export async function persistReportXlsx(
  pacienteId: string,
  bytes: Uint8Array,
  periodDays: number,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
  patientName?: string,
): Promise<{ persistentUri: string; filename: string }> {
  return persistReportFile(
    pacienteId,
    { type: 'bytes', bytes },
    periodDays,
    'xlsx',
    adapter,
    undefined,
    patientName,
  );
}

export type ShareReportResult = 'shared_sheet_opened' | 'sharing_unavailable';

export async function shareReportFile(
  fileUri: string,
  format: ReportFileFormat,
): Promise<ShareReportResult> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return 'sharing_unavailable';
    }
    const mimeType =
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const dialogTitle =
      format === 'pdf'
        ? 'Compartir reporte de signos vitales (PDF)'
        : 'Compartir reporte de signos vitales y síntomas (Excel)';
    const uti = format === 'pdf' ? 'com.adobe.pdf' : 'org.openxmlformats.spreadsheetml.sheet';

    let temporary: File | null = null;
    const assertCurrent = clinicalFileLease(fileUri);
    try {
      let shareUri = fileUri;
      if (isClinicalFile(fileUri)) {
        const bytes = await readClinicalFile(fileUri, await new File(fileUri).bytes());
        const crypto = await import('expo-crypto');
        assertCurrent();
        const directory = new Directory(Paths.cache, 'qc_share');
        directory.create({ intermediates: true, idempotent: true });
        temporary = new File(directory, 'qc_share_' + crypto.randomUUID() + '.' + format);
        temporary.create({ overwrite: false });
        temporary.write(bytes);
        shareUri = temporary.uri;
      }
      assertCurrent();
      await Sharing.shareAsync(shareUri, { mimeType, dialogTitle, UTI: uti });
    } finally {
      if (temporary?.exists) temporary.delete();
    }
    return 'shared_sheet_opened';
  } catch {
    return 'sharing_unavailable';
  }
}

export async function shareReportPdf(pdfUri: string): Promise<ShareReportResult> {
  return shareReportFile(pdfUri, 'pdf');
}

/** Only derived plaintext share copies from a previous process; encrypted originals remain. */
export function cleanupTransientReportExports() {
  const directory = new Directory(Paths.cache, 'qc_share');
  if (!directory.exists) return;
  for (const entry of directory.list()) {
    if (entry instanceof File && /^qc_share_[0-9a-f-]{36}\.(pdf|xlsx)$/.test(entry.name))
      entry.delete();
  }
}

/**
 * Lista las URIs de los reportes persistidos localmente para el paciente (PDF y XLSX).
 * Propaga errores de acceso y omite directorios no creados devolviendo [].
 */
export async function listPatientReports(
  pacienteId: string,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
): Promise<string[]> {
  assertSafeId(pacienteId, 'pacienteId');
  return withPatientReportLock(pacienteId, async () => {
    const dir = getPatientReportDirectory(pacienteId);
    if (!(await adapter.directoryExists(dir.uri))) return [];
    const entries = await adapter.listDirectory(dir.uri);
    return entries
      .filter((entry) => entry.isFile && REPORT_FILENAME_REGEX.test(entry.name))
      .map((entry) => entry.uri);
  });
}

/**
 * Lista los metadatos completos de los reportes persistidos para el paciente,
 * ordenados de más reciente a más antiguo, omitiendo de forma tolerante archivos ajenos.
 * Propaga errores reales de acceso y lectura del directorio.
 */
async function listPatientReportsInternal(
  pacienteId: string,
  adapter: BinaryReportStorageAdapter,
): Promise<PatientReportItem[]> {
  await cleanOrphanedTempReportsInternal(pacienteId, adapter);
  await flushPendingReportCleanups(adapter, pacienteId);
  const dir = getPatientReportDirectory(pacienteId);
  if (!(await adapter.directoryExists(dir.uri))) return [];
  const entries = await adapter.listDirectory(dir.uri);
  const reports: PatientReportItem[] = [];
  for (const entry of entries) {
    if (entry.isFile && entry.name) {
      const filename = entry.name;
      const match = filename.match(REPORT_FILENAME_REGEX);
      if (!match) continue; // Omitir individualmente archivos con nombres no coincidentes
      const periodDays = Number(match[1]);
      if (periodDays !== 7 && periodDays !== 30 && periodDays !== 90 && periodDays !== 365)
        continue; // Omitir períodos inválidos

      const timestampMs = Number(match[3]);
      if (!Number.isFinite(timestampMs)) continue;
      const date = new Date(timestampMs);
      if (Number.isNaN(date.getTime())) continue; // Omitir timestamps no convertibles a fecha

      const format = match[4].toLowerCase() as ReportFileFormat;
      reports.push({
        uri: entry.uri,
        filename,
        format,
        periodDays,
        generatedAt: date.toISOString(),
        sizeBytes: entry.size,
      });
    }
  }
  reports.sort((a, b) => {
    const timeA = a.generatedAt ? Date.parse(a.generatedAt) : 0;
    const timeB = b.generatedAt ? Date.parse(b.generatedAt) : 0;
    return timeB - timeA;
  });
  return reports;
}

export async function getPatientReportList(
  pacienteId: string,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
): Promise<PatientReportItem[]> {
  assertSafeId(pacienteId, 'pacienteId');
  return withPatientReportLock(pacienteId, () => listPatientReportsInternal(pacienteId, adapter));
}

/**
 * Elimina un reporte específico del paciente activo dentro del bloqueo de almacenamiento.
 */
export async function deletePatientReport(
  pacienteId: string,
  fileName: string,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
): Promise<boolean> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeReportFileName(fileName);
  return withPatientReportLock(pacienteId, async () => {
    const dir = getPatientReportDirectory(pacienteId);
    const targetUri = `${dir.uri}/${fileName}`;
    if (!(await adapter.fileExists(targetUri))) return false;
    try {
      await adapter.deleteFile(targetUri);
      const companionA11y = `${targetUri}.a11y.json`;
      if (await adapter.fileExists(companionA11y)) {
        try {
          await adapter.deleteFile(companionA11y);
        } catch {
          /* safe non-blocking cleanup */
        }
      }
      return true;
    } catch {
      return false;
    }
  });
}

export async function clearAllPatientReports(
  pacienteId: string,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
): Promise<{ deleted: number; freedBytes: number }> {
  assertSafeId(pacienteId, 'pacienteId');
  return withPatientReportLock(pacienteId, async () => {
    const list = await listPatientReportsInternal(pacienteId, adapter);
    let deleted = 0;
    let freedBytes = 0;
    for (const report of list) {
      try {
        await adapter.deleteFile(report.uri);
        deleted++;
        freedBytes += report.sizeBytes || 0;
        const companionA11y = `${report.uri}.a11y.json`;
        if (await adapter.fileExists(companionA11y)) {
          try {
            await adapter.deleteFile(companionA11y);
          } catch {
            /* safe non-blocking cleanup */
          }
        }
      } catch {
        /* continue on individual failure */
      }
    }
    return { deleted, freedBytes };
  });
}

export async function readPatientReportA11ySnapshot<T = unknown>(
  pacienteId: string,
  fileName: string,
  adapter: BinaryReportStorageAdapter = defaultAdapter,
): Promise<T | null> {
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeReportFileName(fileName);
  return withPatientReportLock(pacienteId, async () => {
    const dir = getPatientReportDirectory(pacienteId);
    const a11yUri = `${dir.uri}/${fileName}.a11y.json`;
    if (!(await adapter.fileExists(a11yUri))) return null;
    try {
      const file = new File(a11yUri);
      const rawBytes = await file.bytes();
      const decrypted = await readClinicalFile(a11yUri, rawBytes);
      const jsonStr = new TextDecoder().decode(decrypted);
      return JSON.parse(jsonStr) as T;
    } catch {
      return null;
    }
  });
}
