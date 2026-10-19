import { computeSha256 } from '../../../utils/crypto';
import type {
  ActiveEducationalCopyFormat,
  EducationalContentType,
  EducationalLocalCopyMetadata,
} from '../education/education-types';
import { ExpoFileStorageAdapter, type FileStorageAdapter } from './file-storage-adapter';
import {
  assertSafeId,
  getPatientResourceDirectory,
  registerActiveWrite,
  withPatientResourceLock,
} from './resource-storage';

export const MAX_EDUCATIONAL_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MiB (5,242,880 bytes)
export const MAX_EDUCATIONAL_IMAGE_PIXELS = 8_000_000; // 8 Megapíxeles

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
  formato: ActiveEducationalCopyFormat;
  content: string | Uint8Array;
  versionOrigen?: string;
  mimeType?: string;
  titulo?: string;
  tipo?: EducationalContentType;
  descripcion?: string;
  textoAccesible?: string;
  anchoPx?: number;
  altoPx?: number;
  previousRutaLocal?: string | null;
  getPreviousRutaLocal?: () => Promise<string | null | undefined> | string | null | undefined;
  tokenGenerator?: () => string;
  persistCopyInTx: (params: {
    rutaLocal: string;
    formato: ActiveEducationalCopyFormat;
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
export interface ImageDimensions {
  width: number;
  height: number;
  format: 'png' | 'jpeg';
}

/**
 * Parsea y valida la cabecera binaria de imágenes PNG o JPEG para extraer sus dimensiones exactas.
 */
export function parseImageHeader(bytes: Uint8Array): ImageDimensions {
  if (bytes.length < 8) {
    throw new Error('Archivo corrupto o incompleto: cabecera binaria insuficiente.');
  }

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  if (isPng) {
    if (bytes.length < 24) {
      throw new Error('Cabecera PNG incompleta para extraer dimensiones IHDR.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false); // big-endian
    const height = view.getUint32(20, false); // big-endian
    if (width === 0 || height === 0) {
      throw new Error('Dimensiones PNG inválidas en cabecera IHDR.');
    }
    return { width, height, format: 'png' };
  }

  // JPEG magic bytes: FF D8 FF
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isJpeg) {
    let offset = 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        throw new Error('Formato JPEG corrupto: marcador inválido.');
      }
      while (bytes[offset] === 0xff && offset < bytes.length) {
        offset++;
      }
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];

      if (marker === 0xd9 || marker === 0xda) {
        break;
      }
      if (marker >= 0xd0 && marker <= 0xd7) {
        continue;
      }

      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset, false);
      if (length < 2) {
        throw new Error('Longitud de segmento JPEG inválida.');
      }

      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);

      if (isSof) {
        if (offset + 7 > bytes.length) {
          throw new Error('Segmento SOF de JPEG incompleto.');
        }
        const height = view.getUint16(offset + 3, false);
        const width = view.getUint16(offset + 5, false);
        if (width === 0 || height === 0) {
          throw new Error('Dimensiones JPEG inválidas en marcador SOF.');
        }
        return { width, height, format: 'jpeg' };
      }

      offset += length;
    }
    throw new Error('No se encontró el marcador de dimensiones (SOF) en la imagen JPEG.');
  }

  throw new Error(
    'Formato de imagen no reconocido: solo se admiten cabeceras binarias PNG y JPEG.',
  );
}

/**
 * Genera un buffer binario mínimo de PNG válido con dimensiones específicas para pruebas o fixtures sintéticos.
 */
export function createMinimalPng(width = 10, height = 10): Uint8Array {
  const buffer = new Uint8Array(33);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.set([0x00, 0x00, 0x00, 0x0d], 8);
  buffer.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(buffer.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  buffer.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
  return buffer;
}

/**
 * Genera un buffer binario mínimo de JPEG válido con dimensiones específicas para pruebas o fixtures sintéticos.
 */
export function createMinimalJpeg(width = 10, height = 10): Uint8Array {
  const buffer = new Uint8Array(17);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer[4] = 0x00;
  buffer[5] = 0x0b;
  buffer[6] = 0x08;
  const view = new DataView(buffer.buffer);
  view.setUint16(7, height, false);
  view.setUint16(9, width, false);
  buffer[11] = 0x03;
  buffer[12] = 0x01;
  buffer[13] = 0x11;
  buffer[14] = 0x00;
  buffer[15] = 0xff;
  buffer[16] = 0xd9;
  return buffer;
}

export async function saveEducationalMediaWithCompensation(
  params: SaveMediaParams,
): Promise<SaveMediaResult> {
  const { pacienteId, contenidoId, formato, content } = params;
  assertSafeId(pacienteId, 'pacienteId');
  assertSafeId(contenidoId, 'contenidoId');

  if ((formato as string) === 'markdown' || (formato !== 'png' && formato !== 'jpeg')) {
    throw new Error('Formato no permitido: solo se admiten imágenes PNG y JPEG para descarga.');
  }

  if (!params.textoAccesible || params.textoAccesible.trim().length === 0) {
    throw new Error('El recurso educativo tipo infografía requiere un texto accesible no vacío.');
  }

  const rawBytes: Uint8Array =
    typeof content === 'string'
      ? /^[A-Za-z0-9+/=]+$/.test(content.trim()) && content.length % 4 === 0
        ? Uint8Array.from(Buffer.from(content, 'base64'))
        : new TextEncoder().encode(content)
      : content;

  const tamanoBytes = rawBytes.byteLength;
  if (tamanoBytes > MAX_EDUCATIONAL_MEDIA_BYTES) {
    throw new Error('El archivo supera el tamaño máximo permitido de 5 MB.');
  }

  // Validación estricta de cabecera binaria y resolución sin depender de opciones opcionales
  const dimensions = parseImageHeader(rawBytes);
  if (formato === 'png' && dimensions.format !== 'png') {
    throw new Error('La cabecera binaria no corresponde a una imagen PNG válida.');
  }
  if (formato === 'jpeg' && dimensions.format !== 'jpeg') {
    throw new Error('La cabecera binaria no corresponde a una imagen JPEG válida.');
  }

  const totalPixels = dimensions.width * dimensions.height;
  if (totalPixels > MAX_EDUCATIONAL_IMAGE_PIXELS) {
    throw new Error('La imagen supera la resolución máxima permitida de 8 megapíxeles.');
  }

  const anchoPx = dimensions.width;
  const altoPx = dimensions.height;

  const adapter = params.adapter ?? defaultExpoAdapter;

  return withPatientResourceLock(pacienteId, async () => {
    // Identificar la ruta anterior dentro del bloqueo de exclusión mutua
    const previousRutaLocal = params.getPreviousRutaLocal
      ? await params.getPreviousRutaLocal()
      : params.previousRutaLocal;

    const baseDir = params.baseDirResolver
      ? params.baseDirResolver(pacienteId)
      : getPatientResourceDirectory(pacienteId).uri;

    await adapter.ensureDirectory(baseDir);

    const baseDirClean = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const extension = formato === 'png' ? 'png' : 'jpg';
    const token = params.tokenGenerator
      ? params.tokenGenerator()
      : `${contenidoId}.${Date.now()}.${generateSafeUuid()}`;
    const tmpUri = `${baseDirClean}/${token}.tmp`;
    const finalUri = `${baseDirClean}/${token}.${extension}`;

    // Cálculo estricto de SHA-256 sobre los bytes reales
    const sha256 = await computeSha256(rawBytes);

    // Proteger temporal y destino en activeWrites
    const unregister = registerActiveWrite([tmpUri, finalUri]);

    let finalFileCreated = false;
    let dbCommitted = false;

    try {
      // 1. Escritura en temporal
      if (typeof adapter.writeBinary === 'function') {
        await adapter.writeBinary(tmpUri, rawBytes);
      } else {
        await adapter.writeText(tmpUri, Buffer.from(rawBytes).toString('base64'));
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
          textoAccesible: params.textoAccesible,
          anchoPx,
          altoPx,
        },
      });

      // 4. dbCommitted cambia ESTRICTAMENTE DESPUÉS del COMMIT real
      dbCommitted = true;

      // 5. Tras confirmar la nueva copia y su transacción en SQLite,
      // limpiar el archivo anterior reemplazado si existía y difiere del nuevo
      if (previousRutaLocal && previousRutaLocal !== finalUri) {
        const normPrev = previousRutaLocal.replace(/\\/g, '/');
        const normFinal = finalUri.replace(/\\/g, '/');
        if (normPrev !== normFinal) {
          try {
            if (
              isPathInPatientMediaDirectory(
                previousRutaLocal,
                pacienteId,
                contenidoId,
                params.baseDirResolver,
                { allowLegacy: true },
              )
            ) {
              if (await adapter.exists(previousRutaLocal)) {
                await adapter.deleteFile(previousRutaLocal);
              }
            }
          } catch {
            // Ignorar fallo de limpieza no crítica de archivo anterior
          }
        }
      }

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
