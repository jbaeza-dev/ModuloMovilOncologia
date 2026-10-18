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

export interface BulkDownloadResult {
  total: number;
  downloaded: number;
  skipped: number;
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

/**
 * Coordina la descarga masiva de infografías del catálogo para el paciente actual.
 * Procesa en serie, verifica archivos existentes, omite recursos no descargables
 * y soporta cancelación limpia sin dejar archivos huérfanos.
 */
export async function runBulkInfographicDownload(
  options: RunBulkDownloadOptions,
): Promise<BulkDownloadResult> {
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
      cancelled: false,
      alreadyUpToDate: true,
      message: 'No hay infografías disponibles para descargar en el catálogo.',
    };
  }

  // 3. Consultar copias existentes en SQLite para el paciente
  const existingCopies = await repository.education.listLocalCopies();
  const copyMap = new Map(existingCopies.map((c) => [c.contentId, c]));

  // 4. Determinar cuáles necesitan ser descargadas (verificando existencia física)
  const pendingToDownload: EducationalResource[] = [];
  let alreadyPresentCount = 0;

  for (const resource of infographics) {
    const copy = copyMap.get(resource.id);
    const physicallyPresent =
      copy && copy.rutaRelativa
        ? resourceFileExists(patientId, resource.id, copy.rutaRelativa)
        : false;

    if (physicallyPresent && copy?.estado !== 'error') {
      alreadyPresentCount++;
    } else {
      pendingToDownload.push(resource);
    }
  }

  // Si todas ya están disponibles físicamente
  if (pendingToDownload.length === 0) {
    return {
      total: infographics.length,
      downloaded: 0,
      skipped: alreadyPresentCount,
      cancelled: false,
      alreadyUpToDate: true,
      message: 'Todas las infografías ya están disponibles sin conexión.',
    };
  }

  const totalToDownload = pendingToDownload.length;
  let downloadedCount = 0;

  // 5. Descargar en serie con reporte de progreso y comprobación de cancelación
  for (let i = 0; i < totalToDownload; i++) {
    if (signal?.aborted) {
      return {
        total: totalToDownload,
        downloaded: downloadedCount,
        skipped: alreadyPresentCount,
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
    } catch {
      // Si la descarga individual falla, se omite y continúa con las siguientes
    }
  }

  if (signal?.aborted) {
    return {
      total: totalToDownload,
      downloaded: downloadedCount,
      skipped: alreadyPresentCount,
      cancelled: true,
      alreadyUpToDate: false,
      message:
        downloadedCount > 0
          ? `Descarga cancelada. Se conservaron ${downloadedCount} infografía${downloadedCount === 1 ? '' : 's'} completada${downloadedCount === 1 ? '' : 's'}.`
          : 'Descarga cancelada.',
    };
  }

  return {
    total: totalToDownload,
    downloaded: downloadedCount,
    skipped: alreadyPresentCount,
    cancelled: false,
    alreadyUpToDate: false,
    message: `${downloadedCount} infografía${downloadedCount === 1 ? '' : 's'} guardada${downloadedCount === 1 ? '' : 's'} para ver sin conexión.`,
  };
}
