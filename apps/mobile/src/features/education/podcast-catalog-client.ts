import type { PodcastEpisode } from './PodcastPlaybackContext';

export async function fetchPodcastCatalog(
  base: string,
  signal?: AbortSignal,
): Promise<PodcastEpisode[]> {
  const response = await fetch(base.replace(/\/$/, '') + '/educacion/api/v1/podcasts', { signal });
  if (!response.ok) throw new Error('No se pudieron consultar los podcasts.');
  const data: unknown = await response.json();
  const rows = (data as { episodios?: unknown })?.episodios;
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Catálogo inválido.');
  const ids = new Set<string>();
  return rows.map((row: unknown) => {
    const item = row as PodcastEpisode;
    if (
      !item ||
      !/^[A-Za-z0-9_-]{10,100}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 200 ||
      typeof item.category !== 'string' ||
      !item.category.trim() ||
      item.category.length > 200
    )
      throw new Error('Catálogo inválido.');
    ids.add(item.id);
    return { id: item.id, title: item.title, category: item.category };
  });
}
