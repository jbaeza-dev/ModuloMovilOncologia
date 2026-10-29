import type { EducationalResource } from '../../data/local/education/education-types';
import { isUuid } from '../../services/session/response-checks';

const MAX_BYTES = 5 * 1024 * 1024;
class ImageDownloadFailure extends Error {}
export function publishedImage(resource: EducationalResource) {
  const asset = resource.asset;
  if (
    resource.type !== 'infografia' ||
    asset?.type !== 'remote' ||
    !['image/png', 'image/jpeg'].includes(asset.mimeType) ||
    !Number.isSafeInteger(asset.expectedBytes) ||
    Number(asset.expectedBytes) <= 0 ||
    Number(asset.expectedBytes) > MAX_BYTES ||
    !isUuid(asset.revision) ||
    !/^[0-9a-f]{64}$/.test(asset.expectedSha256 ?? '')
  )
    throw new Error('La imagen no tiene metadatos de publicación verificables.');
  return asset as typeof asset & {
    expectedBytes: number;
    expectedSha256: string;
    revision: string;
  };
}

/** Byte download is bounded; no video, conversion or decompressed image raster is persisted. */
export async function fetchPublishedImage(
  resource: EducationalResource,
  options: {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    allowDemoHttp?: boolean;
  } = {},
) {
  const asset = publishedImage(resource),
    url = new URL(asset.url);
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(url.protocol === 'https:' || (options.allowDemoHttp && url.protocol === 'http:'))
  )
    throw new Error('La dirección de descarga de la imagen no es segura.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, 30_000);
  try {
    const response = await (options.fetcher ?? fetch)(url.href, {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: asset.mimeType },
    });
    if (response.status !== 200)
      throw new ImageDownloadFailure('No se pudo descargar la imagen publicada.');
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== asset.mimeType)
      throw new ImageDownloadFailure('El servidor devolvió un formato de imagen diferente.');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== asset.expectedBytes))
      throw new ImageDownloadFailure('La longitud declarada no coincide con la publicación.');
    let bytes: Uint8Array;
    if (response.body?.getReader) {
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > asset.expectedBytes)
            throw new ImageDownloadFailure('La descarga supera la longitud publicada.');
          chunks.push(chunk.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else bytes = new Uint8Array(await response.arrayBuffer());
    if (controller.signal.aborted)
      throw new ImageDownloadFailure('Se interrumpió la descarga de la imagen.');
    if (bytes.byteLength !== asset.expectedBytes)
      throw new ImageDownloadFailure('La imagen llegó incompleta.');
    return bytes;
  } catch (error) {
    if (controller.signal.aborted)
      throw new ImageDownloadFailure(
        'Se interrumpió la descarga de la imagen. Vuelve a intentarlo.',
      );
    if (error instanceof ImageDownloadFailure) throw error;
    throw new ImageDownloadFailure(
      'No se pudo completar la descarga de la imagen. Revisa la conexión y vuelve a intentarlo.',
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
