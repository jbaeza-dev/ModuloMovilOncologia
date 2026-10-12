import { computeSha256 } from '../../../utils/crypto';
import type {
  EducationalContentType,
  EducationalCopyFormat,
  EducationalLocalCopyMetadata,
} from '../education/education-types';
import { ExpoFileStorageAdapter, type FileStorageAdapter } from './file-storage-adapter';
import {
  assertSafeId,
  getPatientResourceDirectory,
  registerActiveWrite,
  withPatientResourceLock,
} from './resource-storage';

const defaultExpoAdapter = new ExpoFileStorageAdapter();

function generateSafeUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface SaveMediaParams {
  pacienteId: string;
  contenidoId: string;
  formato: EducationalCopyFormat;
  content: string | Uint8Array;
  versionOrigen?: string;
  mimeType?: string;
  titulo?: string;
  tipo?: EducationalContentType;
  descripcion?: string;
  tokenGenerator?: () => string;
  persistCopyInTx: (params: {
    rutaLocal: string;
    formato: EducationalCopyFormat;
    tamanoBytes: number;
    metadataLocal: EducationalLocalCopyMetadata;
  }) => Promise<void>;
  adapter?: FileStorageAdapter;
  baseDirResolver?: (pacienteId: string) => string;
}

export interface SaveMediaResult {
  uri: string;
  tamanoBytes: number;
  sha256: string;
}

/**
 * Comprueba si un nombre de archivo corresponde a un recurso educativo
 * en cualquiera de los formatos soportados: .md, .png, .jpg, .jpeg.
 */
export function isMediaFileForContent(
  fileName: string,
  contenidoId: string,
  options?: { allowLegacy?: boolean },
): boolean {
  assertSafeId(contenidoId, 'contenidoId');
  const allowedExts = ['md', 'png', 'jpg', 'jpeg'];
  for (const ext of allowedExts) {
    if (fileName === `${contenidoId}.${ext}`) return true;

    const prefix = `${contenidoId}.`;
    if (fileName.startsWith(prefix) && fileName.endsWith(`.${ext}`)) {
      const middle = fileName.slice(prefix.length, -(ext.length + 1));
      if (/^[0-9a-zA-Z.-]+$/.test(middle) && !middle.includes('..')) return true;
    }

    if (options?.allowLegacy) {
      const legacyPrefix = `${contenidoId}_`;
      if (fileName.startsWith(legacyPrefix) && fileName.endsWith(`.${ext}`)) {
        const middle = fileName.slice(legacyPrefix.length, -(ext.length + 1));
        if (/^\d+$/.test(middle)) return true;
      }
    }
  }

  return false;
}

/**
 * Valida estrictamente que una ruta pertenezca al directorio del paciente activo y no
 * acceda a rutas de otros pacientes o del sistema mediante path traversal.
 */
export function isPathInPatientMediaDirectory(
  ruta: string,
  pacienteId: string,
  contenidoId?: string,
  baseDirResolver?: (pacienteId: string) => string,
  options?: { allowLegacy?: boolean },
): boolean {
  assertSafeId(pacienteId, 'pacienteId');
  if (contenidoId) assertSafeId(contenidoId, 'contenidoId');

  const baseDir = baseDirResolver
    ? baseDirResolver(pacienteId)
    : getPatientResourceDirectory(pacienteId).uri;

  const normalizedBase = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedRuta = ruta.replace(/\\/g, '/');

  if (!normalizedRuta.startsWith(normalizedBase + '/')) {
    return false;
  }

  const relative = normalizedRuta.slice(normalizedBase.length + 1);
  if (relative.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    return false;
  }

  if (contenidoId) {
    const basename = relative.split('/').pop() || '';
    return isMediaFileForContent(basename, contenidoId, options);
  }

  return true;
}

/**
 * Coordinador de guardado multimedia seguro con compensación y exclusión mutua por paciente:
 * 1. Coordina con withPatientResourceLock para evitar carreras concurrentes.
 * 2. Registra tanto .tmp como el destino final en activeWrites.
 * 3. Asigna nombre único con UUID y calcula el SHA-256 sobre los bytes reales.
 * 4. Escribe el temporal y lo mueve a destino con overwrite: false para prevenir colisiones.
 * 5. Ejecuta persistencia en base de datos.
 * 6. dbCommitted cambia ESTRICTAMENTE DESPUÉS del COMMIT real.
 * 7. En caso de fallo antes del commit, la compensación elimina EXCLUSIVAMENTE los archivos creados por este intento
 *    y limpia temporales parciales si existen en disco.
 */
export async function saveEducationalMediaWithCompensation(
  params: SaveMediaParams,
): Promise<SaveMediaResult> {
  const { pacienteId, contenidoId, formato, content } = params;
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

  const adapter = params.adapter ?? defaultExpoAdapter;

  return withPatientResourceLock(pacienteId, async () => {
    const baseDir = params.baseDirResolver
      ? params.baseDirResolver(pacienteId)
      : getPatientResourceDirectory(pacienteId).uri;

    await adapter.ensureDirectory(baseDir);

    const baseDirClean = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const extension = formato === 'markdown' ? 'md' : formato === 'png' ? 'png' : 'jpg';
    const token = params.tokenGenerator
      ? params.tokenGenerator()
      : `${contenidoId}.${Date.now()}.${generateSafeUuid()}`;
    const tmpUri = `${baseDirClean}/${token}.tmp`;
    const finalUri = `${baseDirClean}/${token}.${extension}`;

    // Cálculo estricto de SHA-256 y tamaño sobre los bytes reales
    const isString = typeof content === 'string';
    const tamanoBytes = isString ? new TextEncoder().encode(content).length : content.byteLength;
    const sha256 = await computeSha256(content);

    // Proteger temporal y destino en activeWrites
    const unregister = registerActiveWrite([tmpUri, finalUri]);

    let finalFileCreated = false;
    let dbCommitted = false;

    try {
      // 1. Escritura en temporal
      if (isString) {
        await adapter.writeText(tmpUri, content);
      } else if (typeof adapter.writeBinary === 'function') {
        await adapter.writeBinary(tmpUri, content);
      } else {
        await adapter.writeText(tmpUri, Buffer.from(content).toString('base64'));
      }

      // 2. Mover temporal a destino final sin sobrescritura (rechaza colisión)
      await adapter.moveFile(tmpUri, finalUri, { overwrite: false });
      finalFileCreated = true;

      // 3. Confirmar persistencia en SQLite
      await params.persistCopyInTx({
        rutaLocal: finalUri,
        formato,
        tamanoBytes,
        metadataLocal: {
          sha256,
          versionOrigen: params.versionOrigen,
          mimeType: params.mimeType,
          titulo: params.titulo,
          tipo: params.tipo,
          descripcion: params.descripcion,
        },
      });

      // 4. dbCommitted cambia ESTRICTAMENTE DESPUÉS del COMMIT real
      dbCommitted = true;

      return {
        uri: finalUri,
        tamanoBytes,
        sha256,
      };
    } catch (error) {
      // 5. Compensación: si la base de datos no confirmó el commit,
      // eliminar EXCLUSIVAMENTE los archivos creados por este intento
      if (!dbCommitted) {
        if (finalFileCreated) {
          try {
            await adapter.deleteFile(finalUri);
          } catch {
            // Ignorar fallo en borrado de compensación
          }
        }
        // Limpieza de temporal: si la escritura falló a mitad o antes de mover,
        // eliminar el temporal si existe en disco (cubre escrituras parciales)
        try {
          if (await adapter.exists(tmpUri)) {
            await adapter.deleteFile(tmpUri);
          }
        } catch {
          // Ignorar fallo en borrado del temporal
        }
      }
      throw error;
    } finally {
      unregister();
    }
  });
}
