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
}: {
  resource: EducationalResource;
  patientId: string;
  repository: PatientRepository;
  database: SqlConnection;
  localCopy?: EducationalLocalCopy | null;
}): Promise<void> {
  if (resource.type !== 'infografia') {
    throw new Error('Solo se permite la descarga de infografías en formato de imagen.');
  }

  const isJpeg =
    resource.asset?.extension === 'jpg' ||
    resource.asset?.extension === 'jpeg' ||
    Boolean(resource.asset?.mimeType?.toLowerCase().includes('jpeg'));
  const formato: ActiveEducationalCopyFormat = isJpeg ? 'jpeg' : 'png';
  const mimeType = isJpeg ? 'image/jpeg' : (resource.asset?.mimeType ?? 'image/png');

  const assetKey = resource.asset?.type === 'bundled' ? resource.asset.assetKey : '';
  const assetModule = getBundledAsset(assetKey);

  if (!assetModule) {
    throw new Error('El archivo de la infografía no se encuentra empaquetado en este dispositivo.');
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
  const contentToSave = await fileObj.bytes();

  await saveEducationalMediaWithCompensation({
    pacienteId: patientId,
    contenidoId: resource.id,
    formato,
    content: contentToSave,
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
      await database.transaction(async (tx: SqlConnection) => {
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
