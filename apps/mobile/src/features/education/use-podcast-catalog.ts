import { useCallback } from 'react';
import { useFocusedValue } from '../../hooks/use-local-query';
import type { PodcastEpisode } from './PodcastPlaybackContext';

import { fetchPodcastCatalog } from './podcast-catalog-client';

/** Refresh on focus. Only public educational metadata; no tokens or patient data. */
export function usePodcastCatalog() {
  const base = process.env.EXPO_PUBLIC_CLINICAL_URL;
  const load = useCallback(async () => {
    if (!base) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await fetchPodcastCatalog(base, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  }, [base]);
  const result = useFocusedValue<PodcastEpisode[]>(load, []);
  return { ...result, episodes: result.value };
}
