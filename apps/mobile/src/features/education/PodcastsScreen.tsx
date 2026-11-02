import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Text } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';
import { usePodcastPlayback } from './PodcastPlaybackContext';
import { launchPodcast } from './podcasts';
import { usePodcastCatalog } from './use-podcast-catalog';

export function PodcastsScreen() {
  const {
    episodes: publishedPodcasts,
    loading: podcastsLoading,
    error: podcastsError,
    refresh: refreshPodcasts,
  } = usePodcastCatalog();
  const { episodio } = useLocalSearchParams<{ episodio?: string }>();
  const episodes = episodio
    ? publishedPodcasts.filter((episode) => episode.id === episodio)
    : publishedPodcasts;
  const { theme } = useAppTheme();
  const playback = usePodcastPlayback();
  const opening = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(id: string) {
    if (opening.current) return;
    opening.current = true;
    setBusyId(id);
    setError(null);
    try {
      const episode = publishedPodcasts.find((p) => p.id === id);
      if (playback?.isConfigured && episode) {
        await playback.playEpisode(episode);
        router.push('/educacion/podcast-reproductor');
      } else {
        const result = await launchPodcast(id, publishedPodcasts);
        if (!result.opened) setError(result.error ?? 'No se pudo abrir el podcast.');
      }
    } catch {
      const result = await launchPodcast(id, publishedPodcasts);
      if (!result.opened) setError(result.error ?? 'No se pudo abrir el podcast.');
    } finally {
      opening.current = false;
      setBusyId(null);
    }
  }

  return (
    <Screen mascotPose="reposo" title="Podcasts de CUIDAQUIMIO">
      <BodyText>Escucha mientras usas la app. Requiere internet.</BodyText>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>
          {error}
        </Text>
      ) : null}
      {episodio ? (
        <VisualButton
          label="Ver todos los podcasts"
          secondary
          onPress={() => router.replace('/educacion/podcasts')}
        />
      ) : null}
      {podcastsLoading ? <BodyText>Buscando podcasts…</BodyText> : null}
      {podcastsError ? <VisualButton label="Reintentar" onPress={refreshPodcasts} /> : null}
      {!podcastsLoading && !podcastsError && !episodes.length ? (
        <BodyText>Aún no hay podcasts publicados.</BodyText>
      ) : null}
      {episodes.map((podcast) => (
        <InfoCard key={podcast.id}>
          <SectionTitle>{podcast.title}</SectionTitle>
          <BodyText>{podcast.category}</BodyText>
          <StatusPill>Podcast · Requiere internet</StatusPill>
          <VisualButton
            label={busyId === podcast.id ? 'Abriendo podcast…' : `Escuchar: ${podcast.title}`}
            disabled={busyId !== null}
            onPress={() => void open(podcast.id)}
          />
        </InfoCard>
      ))}
    </Screen>
  );
}
