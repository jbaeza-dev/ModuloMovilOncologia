import { verifyStoredImage } from '../../data/local/files/image-integrity';
import { isPathInPatientMediaDirectory } from '../../data/local/files/educational-storage';
import { resourceContextLease } from '../../data/sync/file-protection';
import { isDemoMode, isUniversityDemo } from '../../utils/environment';
import { fetchPublishedImage, publishedImage } from './remote-image';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import type { SqlConnection } from '../../data/local/core/sql';
import type {
  ActiveEducationalCopyFormat,
  EducationalLocalCopy,
  EducationalResource,
} from '../../data/local/education/education-types';
import { saveEducationalMediaWithCompensation } from '../../data/local/files/educational-storage';
import { deleteResourceFile } from '../../data/local/files/resource-storage';
import type { PatientRepository } from '../../data/local/repository';

/**
 * Resuelve el identificador de recurso empaquetado compatible con Metro y entornos de prueba.
 */
export function getBundledAsset(assetKey: string): number | null {
  try {
    if (assetKey === 'infografia_alimentacion_quimio') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../../../assets/education/infografia_alimentacion_quimio.png');
    }
  } catch {
    // En entornos Node/Vitest, devolver un id numérico de prueba
    return 1;
  }
  return null;
}

/**
 * Guarda o actualiza físicamente una infografía en el almacenamiento local
 * y persiste el registro en SQLite de forma atómica.
 */
export async function downloadAndSaveInfographic({
  resource,
  patientId,
  repository,
  database,
  localCopy,
  signal,
}: {
  resource: EducationalResource;
  patientId: string;
  repository: PatientRepository;
  database: SqlConnection;
  localCopy?: EducationalLocalCopy | null;
  signal?: AbortSignal;
}): Promise<void> {
  const assertContext = resourceContextLease();
  if (resource.type !== 'infografia') {
    throw new Error('Solo se permite la descarga de infografías en formato de imagen.');
  }

  const isJpeg =
    resource.asset?.extension === 'jpg' ||
    resource.asset?.extension === 'jpeg' ||
    Boolean(resource.asset?.mimeType?.toLowerCase().includes('jpeg'));
  const formato: ActiveEducationalCopyFormat = isJpeg ? 'jpeg' : 'png';
  const mimeType = isJpeg ? 'image/jpeg' : (resource.asset?.mimeType ?? 'image/png');

  let contentToSave: Uint8Array;
  const publication = resource.asset?.type === 'remote' ? publishedImage(resource) : null;
  if (publication) {
    contentToSave = await fetchPublishedImage(resource, {
      signal,
      allowDemoHttp:
        (isDemoMode() && process.env.EXPO_PUBLIC_P04_PROBE_ENABLED === 'true') ||
        isUniversityDemo(),
    });
  } else {
    const assetKey = resource.asset?.type === 'bundled' ? resource.asset.assetKey : '';
    const assetModule = getBundledAsset(assetKey);

    if (!assetModule) {
      throw new Error(
        'El archivo de la infografía no se encuentra empaquetado en este dispositivo.',
      );
    }

    const [loadedAsset] = await Asset.loadAsync(assetModule);
    if (
      loadedAsset &&
      (!loadedAsset.localUri ||
        (!loadedAsset.localUri.startsWith('file://') && !loadedAsset.localUri.startsWith('/'))) &&
      typeof loadedAsset.downloadAsync === 'function'
    ) {
      loadedAsset.downloaded = false;
      await loadedAsset.downloadAsync();
    }

    const rawUri = loadedAsset?.localUri ?? loadedAsset?.uri;
    if (!rawUri) {
      throw new Error(
        'No se pudo resolver la ruta local de la infografía empaquetada. Se cancela la operación para conservar la integridad del almacenamiento.',
      );
    }

    const absoluteUri = rawUri.startsWith('file://')
      ? rawUri
      : rawUri.startsWith('/')
        ? `file://${rawUri}`
        : rawUri;
    const fileObj = new File(absoluteUri);
    contentToSave = await fileObj.bytes();
  }

  await saveEducationalMediaWithCompensation({
    pacienteId: patientId,
    contenidoId: resource.id,
    formato,
    content: contentToSave,
    assertContext,
    expectedBytes: publication?.expectedBytes,
    expectedSha256: publication?.expectedSha256,
    versionOrigen: resource.version,
    mimeType,
    titulo: resource.title,
    tipo: resource.type,
    descripcion: resource.description,
    textoAccesible: resource.textoAccesible,
    previousRutaLocal: localCopy?.rutaRelativa ?? localCopy?.rutaAbsoluta,
    getPreviousRutaLocal: async () => {
      const current = await repository.education.getLocalCopy(resource.id);
      return current?.rutaAbsoluta ?? current?.rutaRelativa ?? null;
    },
    persistCopyInTx: async (params) => {
      assertContext();
      await database.transaction(async (tx: SqlConnection) => {
        assertContext();
        if (publication) {
          const checkpoint = await tx.first<{ value_json: string }>(
            "SELECT value_json FROM qc_storage_control WHERE id='education:checkpoint'",
          );
          const rows: Record<string, unknown>[] = checkpoint
            ? JSON.parse(checkpoint.value_json)
            : [];
          const current = rows.find((row) => row.id === resource.id);
          if (
            !current ||
            current.archivo_revision !== publication.revision ||
            current.url !== publication.url ||
            current.archivo_sha256 !== publication.expectedSha256 ||
            current.archivo_tamano_bytes !== publication.expectedBytes
          )
            throw new Error(
              'La publicación cambió o fue retirada durante la descarga. Actualiza el catálogo.',
            );
        }

        await repository.education.persistCopyInTx(tx, {
          contentId: resource.id,
          rutaLocal: params.rutaLocal,
          formato: params.formato,
          tamanoBytes: params.tamanoBytes,
          nowIso: new Date().toISOString(),
          metadataLocal: params.metadataLocal,
        });
      });
    },
  });
}

/**
 * Elimina una copia física comprobando su eliminación antes de limpiar SQLite.
 */
export async function removeLocalInfographicCopy({
  contentId,
  patientId,
  repository,
  localCopy,
}: {
  contentId: string;
  patientId: string;
  repository: PatientRepository;
  localCopy?: EducationalLocalCopy | null;
}): Promise<void> {
  if (localCopy?.rutaRelativa) {
    const physicallyDeleted = await deleteResourceFile(
      patientId,
      contentId,
      localCopy.rutaRelativa,
    );
    if (!physicallyDeleted) {
      throw new Error(
        'No se pudo confirmar la eliminación física del archivo del almacenamiento local.',
      );
    }
  }
  await repository.education.removeLocalCopy(contentId);
}

export async function verifiedLocalImageCopy(
  copy: EducationalLocalCopy,
  patientId: string,
): Promise<EducationalLocalCopy> {
  if (!['png', 'jpeg'].includes(copy.formato)) return { ...copy, estado: 'error' };
  const assertContext = resourceContextLease();
  let valid = false;
  try {
    if (
      isPathInPatientMediaDirectory(copy.rutaRelativa, patientId, copy.contentId, undefined, {
        allowLegacy: true,
      })
    ) {
      const file = new File(copy.rutaRelativa);
      if (file.exists) valid = await verifyStoredImage(await file.bytes(), copy);
    }
  } catch {
    valid = false;
  }
  assertContext();
  return valid ? copy : { ...copy, estado: 'error' };
}
export async function verifiedLocalImageCopies(copies: EducationalLocalCopy[], patientId: string) {
  const result: EducationalLocalCopy[] = [];
  // Limit peak memory to one image while checking a complete offline library.
  for (const copy of copies) result.push(await verifiedLocalImageCopy(copy, patientId));
  return result;
}
