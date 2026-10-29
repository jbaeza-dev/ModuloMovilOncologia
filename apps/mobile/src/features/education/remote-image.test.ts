import { describe, expect, it, vi } from 'vitest';
import { fetchPublishedImage, publishedImage } from './remote-image';
import type { EducationalResource } from '../../data/local/education/education-types';
const resource: EducationalResource = {
  id: '8384c56c-0b01-5629-9108-0ec27217646e',
  title: 'Synthetic',
  description: 'Synthetic',
  category: 1,
  categoryName: 'Synthetic',
  type: 'infografia',
  version: '1',
  asset: {
    type: 'remote',
    url: 'https://example.test/image.png',
    extension: 'png',
    mimeType: 'image/png',
    expectedBytes: 3,
    expectedSha256: 'a'.repeat(64),
    revision: '38a00cb5-7f84-5076-9c22-2378dad7ea71',
  },
};
const respond = (
  body: Uint8Array,
  headers: Record<string, string> = { 'content-type': 'image/png' },
) =>
  vi.fn(
    async () => new Response(body as BodyInit, { status: 200, headers }),
  ) as unknown as typeof fetch;
describe('bounded original-image transport', () => {
  it('explains interrupted native transport in Spanish without exposing platform errors', async () => {
    const failed = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(fetchPublishedImage(resource, { fetcher: failed })).rejects.toThrow(
      'Revisa la conexión y vuelve a intentarlo',
    );
    const native = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => {
        throw new Error('unexpected end of stream');
      },
    })) as unknown as typeof fetch;
    await expect(fetchPublishedImage(resource, { fetcher: native })).rejects.toThrow(
      'No se pudo completar la descarga de la imagen',
    );
  });
  it('returns exactly the original bytes without rewriting image content', async () => {
    const raw = new Uint8Array([1, 2, 3]);
    expect(await fetchPublishedImage(resource, { fetcher: respond(raw) })).toEqual(raw);
  });
  it('rejects missing publication metadata and videos before network access', () => {
    expect(() => publishedImage({ ...resource, type: 'video' })).toThrow('metadatos');
    expect(() =>
      publishedImage({ ...resource, asset: { ...resource.asset!, expectedBytes: 0 } as never }),
    ).toThrow();
  });
  it('rejects a truncated stream, oversized stream, wrong declared length and wrong MIME', async () => {
    await expect(
      fetchPublishedImage(resource, { fetcher: respond(new Uint8Array([1, 2])) }),
    ).rejects.toThrow('incompleta');
    await expect(
      fetchPublishedImage(resource, { fetcher: respond(new Uint8Array([1, 2, 3, 4])) }),
    ).rejects.toThrow('supera');
    await expect(
      fetchPublishedImage(resource, {
        fetcher: respond(new Uint8Array(3), { 'content-type': 'image/png', 'content-length': '4' }),
      }),
    ).rejects.toThrow('longitud');
    await expect(
      fetchPublishedImage(resource, {
        fetcher: respond(new Uint8Array(3), { 'content-type': 'text/html' }),
      }),
    ).rejects.toThrow('formato');
  });
  it('rejects an already cancelled context and insecure URL', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchPublishedImage(resource, {
        fetcher: respond(new Uint8Array(3)),
        signal: controller.signal,
      }),
    ).rejects.toThrow('interrumpió');
    const insecure = {
      ...resource,
      asset: { ...resource.asset!, url: 'http://example.test/x' } as never,
    };
    await expect(fetchPublishedImage(insecure)).rejects.toThrow('segura');
  });
});
