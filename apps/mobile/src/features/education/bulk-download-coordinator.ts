import type { SqlConnection } from '../../data/local/core/sql';
import type { EducationalResource } from '../../data/local/education/education-types';
import { resourceFileExists } from '../../data/local/files/resource-storage';
import type { PatientRepository } from '../../data/local/repository';
import {
  getEducationalCatalogReader,
  type EducationalCatalogReader,
} from './educational-catalog-service';
import { downloadAndSaveInfographic } from './infographic-storage-service';

export interface BulkDownloadProgress {
  current: number;
  total: number;
  percent: number;
  currentTitle: string;
}

export interface BulkDownloadErrorItem {
  resourceId: string;
  title: string;
  message: string;
}

export interface BulkDownloadResult {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  pendingResources: EducationalResource[];
  errors: BulkDownloadErrorItem[];
  cancelled: boolean;
  alreadyUpToDate: boolean;
  message: string;
}

export interface RunBulkDownloadOptions {
  patientId: string;
  repository: PatientRepository;
  database: SqlConnection;
  catalogReader?: EducationalCatalogReader;
  signal?: AbortSignal;
  onProgress?: (progress: BulkDownloadProgress) => void;
}

interface ActiveDownloadEntry {
  patientId: string;
  abortController: AbortController;
  promise: Promise<BulkDownloadResult>;
}

const activeDownloadsByPatient = new Map<string, ActiveDownloadEntry>();

export function getActiveBulkDownload(patientId: string): ActiveDownloadEntry | undefined {
  return activeDownloadsByPatient.get(patientId);
}

export function cancelActiveBulkDownload(patientId: string): boolean {
  const active = activeDownloadsByPatient.get(patientId);
  if (active) {
    active.abortController.abort();
    return true;
  }
  return false;
}

export function resetActiveBulkDownloadsForTesting(): void {
  activeDownloadsByPatient.clear();
}

/**
 * Coordina la descarga masiva de infografías del catálogo para el paciente actual.
 * Procesa en serie, verifica versiones y existencia física de archivos, omite recursos no descargables,
 * previene ejecuciones simultáneas para el mismo paciente y soporta cancelación limpia sin dejar archivos huérfanos.
 */
export function runBulkInfographicDownload(
  options: RunBulkDownloadOptions,
): Promise<BulkDownloadResult> {
  const { patientId } = options;

  const existingActive = activeDownloadsByPatient.get(patientId);
  if (existingActive) {
    // Si ya existe una descarga en curso para este paciente, une la llamada a la promesa en vuelo
    // para prevenir ejecuciones simultáneas y condiciones de carrera sobre el disco y SQLite.
    return existingActive.promise;
  }

  const internalController = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) {
      internalController.abort();
    } else {
      options.signal.addEventListener('abort', () => internalController.abort(), { once: true });
    }
  }

  const executionPromise = executeBulkDownload({
    ...options,
    signal: internalController.signal,
  }).finally(() => {
    activeDownloadsByPatient.delete(patientId);
  });

  // Reserva sincrónica antes del primer await
  activeDownloadsByPatient.set(patientId, {
    patientId,
    abortController: internalController,
    promise: executionPromise,
  });

  return executionPromise;
}

async function executeBulkDownload(options: RunBulkDownloadOptions): Promise<BulkDownloadResult> {
  const {
    patientId,
    repository,
    database,
    catalogReader = getEducationalCatalogReader(),
    signal,
    onProgress,
  } = options;

  // 1. Obtener todos los recursos del catálogo
  const allResources = await catalogReader.getAllResources();

  // 2. Filtrar únicamente infografías (excluye videos y guías de texto)
  const infographics = allResources.filter((r) => r.type === 'infografia');

  if (infographics.length === 0) {
    return {
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      pendingResources: [],
      errors: [],
      cancelled: false,
      alreadyUpToDate: true,
      message: 'No hay infografías disponibles para descargar en el catálogo.',
    };
  }

  // 3. Consultar copias existentes en SQLite para el paciente
  const existingCopies = await repository.education.listLocalCopies();
  const copyMap = new Map(existingCopies.map((c) => [c.contentId, c]));

  // 4. Determinar cuáles necesitan ser descargadas (verificando existencia física Y versión de origen)
  const pendingToDownload: EducationalResource[] = [];
  let alreadyPresentCount = 0;

  for (const resource of infographics) {
    const copy = copyMap.get(resource.id);
    const physicallyPresent =
      copy && copy.rutaRelativa
        ? resourceFileExists(patientId, resource.id, copy.rutaRelativa)
        : false;

    const versionLocal = copy?.metadataLocal?.versionOrigen;
    const isUpToDate =
      physicallyPresent &&
      copy?.estado !== 'error' &&
      Boolean(versionLocal) &&
      versionLocal === resource.version;

    if (isUpToDate) {
      alreadyPresentCount++;
    } else {
      pendingToDownload.push(resource);
    }
  }

  // Si todas ya están disponibles físicamente con su versión al día
  if (pendingToDownload.length === 0) {
    return {
      total: infographics.length,
      downloaded: 0,
      skipped: alreadyPresentCount,
      failed: 0,
      pendingResources: [],
      errors: [],
      cancelled: false,
      alreadyUpToDate: true,
      message: 'Todas las infografías ya están disponibles sin conexión.',
    };
  }

  const totalToDownload = pendingToDownload.length;
  let downloadedCount = 0;
  let failedCount = 0;
  const errors: BulkDownloadErrorItem[] = [];
  const failedResources: EducationalResource[] = [];

  // 5. Descargar en serie con reporte de progreso y comprobación de cancelación
  for (let i = 0; i < totalToDownload; i++) {
    if (signal?.aborted) {
      const unattempted = pendingToDownload.slice(i);
      const pending = [...failedResources, ...unattempted];
      return {
        total: totalToDownload,
        downloaded: downloadedCount,
        skipped: alreadyPresentCount,
        failed: failedCount,
        pendingResources: pending,
        errors,
        cancelled: true,
        alreadyUpToDate: false,
        message:
          downloadedCount > 0
            ? `Descarga cancelada. Se conservaron ${downloadedCount} infografía${downloadedCount === 1 ? '' : 's'} completada${downloadedCount === 1 ? '' : 's'}.`
            : 'Descarga cancelada.',
      };
    }

    const currentResource = pendingToDownload[i];
    const currentNumber = i + 1;
    const percent = Math.round((i / totalToDownload) * 100);

    onProgress?.({
      current: currentNumber,
      total: totalToDownload,
      percent,
      currentTitle: currentResource.title,
    });

    try {
      const existingCopy = copyMap.get(currentResource.id);
      await downloadAndSaveInfographic({
        resource: currentResource,
        patientId,
        repository,
        database,
        localCopy: existingCopy,
      });

      downloadedCount++;
      const updatedPercent = Math.round((downloadedCount / totalToDownload) * 100);

      onProgress?.({
        current: currentNumber,
        total: totalToDownload,
        percent: updatedPercent,
        currentTitle: currentResource.title,
      });
    } catch (err) {
      failedCount++;
      const errorMessage =
        err instanceof Error ? err.message : 'Error inesperado al descargar la infografía.';
      errors.push({
        resourceId: currentResource.id,
        title: currentResource.title,
        message: errorMessage,
      });
      failedResources.push(currentResource);
    }
  }

  if (signal?.aborted) {
    return {
      total: totalToDownload,
      downloaded: downloadedCount,
      skipped: alreadyPresentCount,
      failed: failedCount,
      pendingResources: failedResources,
      errors,
      cancelled: true,
      alreadyUpToDate: false,
      message:
        downloadedCount > 0
          ? `Descarga cancelada. Se conservaron ${downloadedCount} infografía${downloadedCount === 1 ? '' : 's'} completada${downloadedCount === 1 ? '' : 's'}.`
          : 'Descarga cancelada.',
    };
  }

  let message: string;
  if (failedCount === 0) {
    message = `${downloadedCount} infografía${downloadedCount === 1 ? '' : 's'} guardada${downloadedCount === 1 ? '' : 's'} para ver sin conexión.`;
  } else if (downloadedCount > 0) {
    message = `Se guardaron ${downloadedCount} de ${totalToDownload} infografías. ${failedCount} pendiente${failedCount === 1 ? '' : 's'}.`;
  } else {
    message = `No se pudieron guardar las ${failedCount} infografía${failedCount === 1 ? '' : 's'}.`;
  }

  return {
    total: totalToDownload,
    downloaded: downloadedCount,
    skipped: alreadyPresentCount,
    failed: failedCount,
    pendingResources: failedResources,
    errors,
    cancelled: false,
    alreadyUpToDate: false,
    message,
  };
}
