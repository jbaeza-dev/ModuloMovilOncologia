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
import { CUIDAQUIMIO_PODCASTS, launchPodcast } from './podcasts';

export function PodcastsScreen() {
  const { theme } = useAppTheme();
  const opening = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function open(id: string) {
    if (opening.current) return;
    opening.current = true;
    setBusyId(id);
    setError(null);
    try {
      const result = await launchPodcast(id);
      if (!result.opened) setError(result.error ?? 'No se pudo abrir el podcast.');
    } finally {
      opening.current = false;
      setBusyId(null);
    }
  }
  return (
    <Screen title="Podcasts de CUIDAQUIMIO">
      <BodyText>
        Escucha los episodios del equipo CUIDAQUIMIO en Google Drive. Necesitas conexión a internet;
        los audios no se guardan para uso offline.
      </BodyText>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>
          {error}
        </Text>
      ) : null}
      {CUIDAQUIMIO_PODCASTS.map((podcast) => (
        <InfoCard key={podcast.id}>
          <SectionTitle>{podcast.title}</SectionTitle>
          <BodyText>{podcast.category}</BodyText>
          <StatusPill>Podcast · Solo online</StatusPill>
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
