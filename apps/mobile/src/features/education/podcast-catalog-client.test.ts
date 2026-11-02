import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPodcastCatalog } from './podcast-catalog-client';

afterEach(() => vi.unstubAllGlobals());
describe('published podcast metadata', () => {
  it('loads the configured prefix without credentials or bundled episodes', async () => {
    const item = { id: 'synthetic_audio_123', title: 'Audio de prueba', category: 'Categoría' };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ episodios: [item] })));
    vi.stubGlobal('fetch', request);
    expect(await fetchPodcastCatalog('https://example.org/quimiocare/')).toEqual([item]);
    expect(request).toHaveBeenCalledWith(
      'https://example.org/quimiocare/educacion/api/v1/podcasts',
      { signal: undefined },
    );
  });
  it.each([
    { episodios: [{ id: '../private', title: 'Audio', category: 'Prueba' }] },
    { episodios: [{ id: 'valid_audio_123', title: '', category: 'Prueba' }] },
    { episodios: Array(2).fill({ id: 'valid_audio_123', title: 'Audio', category: 'Prueba' }) },
    { episodios: null },
  ])('rejects malformed and repeated metadata', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(fetchPodcastCatalog('https://example.org')).rejects.toThrow('Catálogo inválido');
  });
  it('reports service failures instead of inventing episodes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await expect(fetchPodcastCatalog('https://example.org')).rejects.toThrow('No se pudieron');
  });
});
