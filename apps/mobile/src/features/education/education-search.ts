import type { EducationalResource } from '../../data/local/education/education-types';
import type { PodcastEpisode } from './PodcastPlaybackContext';

export type EducationSearchFilter = 'all' | 'infografia' | 'video' | 'podcast';
export interface EducationSearchResult {
  key: string;
  id: string;
  title: string;
  subtitle: string;
  type: 'infografia' | 'video' | 'podcast' | 'guia';
}
export const normalizedSearch = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();

/** Searches only the active account's received catalog and the existing reviewed podcast list. */
export function searchEducationalContent(
  resources: readonly EducationalResource[],
  query: string,
  filter: EducationSearchFilter = 'all',
  podcasts: readonly PodcastEpisode[] = [],
): EducationSearchResult[] {
  const words = normalizedSearch(query).split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((word) => normalizedSearch(text).includes(word));
  const results: EducationSearchResult[] = [];
  for (const resource of resources) {
    const label =
      resource.type === 'infografia' ? 'Infografía' : resource.type === 'video' ? 'Video' : 'Guía';
    if (
      (filter === 'all' || filter === resource.type) &&
      matches(`${resource.title} ${resource.description} ${resource.categoryName} ${label}`)
    )
      results.push({
        key: 'resource:' + resource.id,
        id: resource.id,
        title: resource.title,
        subtitle: `${label} · ${resource.categoryName}`,
        type: resource.type,
      });
  }
  if (filter === 'all' || filter === 'podcast') {
    for (const podcast of podcasts) {
      if (matches(`${podcast.title} ${podcast.category} Podcast`))
        results.push({
          key: 'podcast:' + podcast.id,
          id: podcast.id,
          title: podcast.title,
          subtitle: `Podcast · ${podcast.category}`,
          type: 'podcast',
        });
    }
  }
  return results;
}
