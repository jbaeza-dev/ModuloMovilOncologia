import { AppIcon as Feather } from '../../components/AppIcon';
import { router } from 'expo-router';
import React from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Screen } from '../../components/Screen';
import { MascotAvatar } from '../../components/MascotAvatar';
import {
  BodyText,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { MULTIMEDIA_AND_EDUCATION_COPY } from '../../content/patient-copy';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { usePodcastPlayback } from './PodcastPlaybackContext';
import { usePodcastCatalog } from './use-podcast-catalog';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function PodcastPlayerScreen() {
  const { episodes: publishedPodcasts } = usePodcastCatalog();
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const {
    currentEpisode,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    togglePlayPause,
    skipForward,
    skipBackward,
    setRate,
    playEpisode,
  } = usePodcastPlayback();
  const { fontScale } = useWindowDimensions();

  const episodeIndex = currentEpisode
    ? publishedPodcasts.findIndex((p) => p.id === currentEpisode.id)
    : -1;
  const episodeNumber = episodeIndex >= 0 ? episodeIndex + 1 : 1;

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const handleRateChange = (newRate: number) => {
    setRate(newRate);
    AccessibilityInfo.announceForAccessibility(`Velocidad cambiada a ${newRate}x.`);
  };

  return (
    <Screen isRoot={false} scroll={false}>
      <View style={styles.container}>
        {/* Barra superior de navegación */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a la pantalla anterior"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
          >
            <Feather name="arrow-left" size={20} color={appTheme.colors.text} />
            <Text style={styles.navBtnText}>Volver</Text>
          </Pressable>

          <StatusPill>{MULTIMEDIA_AND_EDUCATION_COPY.podcastTitle}</StatusPill>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Minimizar reproductor y continuar navegando"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
          >
            <Feather name="chevron-down" size={20} color={appTheme.colors.primary} />
            {fontScale < 1.3 ? <Text style={styles.navBtnText}>Minimizar</Text> : null}
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {currentEpisode ? (
            <InfoCard>
              {/* Carátula visual con la mascota de QuimioCare */}
              <View style={styles.artworkContainer}>
                <View style={styles.artworkCircle}>
                  <MascotAvatar pose="reposo" size="lg" />
                </View>
              </View>

              <View style={styles.metaContainer}>
                <StatusPill>
                  {episodeIndex >= 0
                    ? `Episodio ${episodeNumber} de ${publishedPodcasts.length}`
                    : 'Podcast'}
                </StatusPill>
                <Text style={styles.episodeTitle}>{currentEpisode.title}</Text>
                <Text style={styles.episodeCategory}>{currentEpisode.category} · CUIDAQUIMIO</Text>
              </View>

              {/* Barra de progreso */}
              <View style={styles.progressContainer}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
                </View>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                  <Text style={styles.timeText}>{formatTime(duration)}</Text>
                </View>
              </View>

              {/* Botonera de reproducción grande */}
              <View style={styles.controlsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={MULTIMEDIA_AND_EDUCATION_COPY.audioRewind15}
                  onPress={() => skipBackward(15)}
                  style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
                >
                  <Feather name="rotate-ccw" size={24} color={appTheme.colors.primary} />
                  <Text style={styles.skipBtnText}>15s</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isPlaying
                      ? MULTIMEDIA_AND_EDUCATION_COPY.audioPaused
                      : MULTIMEDIA_AND_EDUCATION_COPY.audioPlaying
                  }
                  onPress={togglePlayPause}
                  style={({ pressed }) => [styles.playPauseBtn, pressed && styles.pressed]}
                >
                  <Feather
                    name={isPlaying ? 'pause' : 'play'}
                    size={32}
                    color={appTheme.colors.onPrimary}
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={MULTIMEDIA_AND_EDUCATION_COPY.audioForward15}
                  onPress={() => skipForward(15)}
                  style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
                >
                  <Feather name="rotate-cw" size={24} color={appTheme.colors.primary} />
                  <Text style={styles.skipBtnText}>15s</Text>
                </Pressable>
              </View>

              {/* Selector de velocidad de reproducción */}
              <View style={styles.speedRow}>
                <Text style={styles.speedLabel}>{MULTIMEDIA_AND_EDUCATION_COPY.audioSpeed}:</Text>
                {[1.0, 1.25, 1.5].map((rate) => {
                  const isSelected = playbackRate === rate;
                  return (
                    <Pressable
                      key={rate}
                      accessibilityRole="button"
                      accessibilityLabel={`Velocidad ${rate}x`}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => handleRateChange(rate)}
                      style={[styles.rateBtn, isSelected && styles.rateBtnActive]}
                    >
                      <Text style={[styles.rateBtnText, isSelected && styles.rateBtnTextActive]}>
                        {rate}×
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Aviso de continuidad en segundo plano */}
              <View style={styles.backgroundNotice}>
                <Feather name="shield" size={18} color={appTheme.colors.primary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.backgroundNoticeTitle}>Continuidad en segundo plano</Text>
                  <Text style={styles.backgroundNoticeBody}>
                    Puedes bloquear tu teléfono o cambiar de aplicación; el audio continuará
                    reproduciéndose con controles en tu pantalla de bloqueo.
                  </Text>
                </View>
              </View>
            </InfoCard>
          ) : (
            <InfoCard>
              <SectionTitle>Elige un episodio para comenzar</SectionTitle>
              <BodyText>
                Selecciona uno de los episodios de CUIDAQUIMIO para escucharlo mientras navegas por
                la aplicación:
              </BodyText>

              {publishedPodcasts.map((podcast) => (
                <View key={podcast.id} style={{ marginTop: theme.spacing.sm }}>
                  <VisualButton
                    label={`Escuchar: ${podcast.title}`}
                    onPress={() => void playEpisode(podcast)}
                  />
                </View>
              ))}
            </InfoCard>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    navBtn: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    navBtnText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.text,
    },
    pressed: {
      opacity: 0.7,
    },
    scrollArea: {
      flex: 1,
    },
    scrollContent: {
      paddingBottom: theme.spacing.xl,
    },
    artworkContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: theme.spacing.md,
    },
    artworkCircle: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.primary,
    },
    metaContainer: {
      alignItems: 'center',
      textAlign: 'center',
      gap: 4,
      marginBottom: theme.spacing.md,
    },
    episodeTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      marginTop: theme.spacing.xs,
    },
    episodeCategory: {
      fontSize: 13.5,
      fontWeight: '600',
      color: colors.secondary,
      textAlign: 'center',
    },
    progressContainer: {
      marginVertical: theme.spacing.sm,
    },
    progressTrack: {
      height: 6,
      width: '100%',
      backgroundColor: colors.mutedSurface,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressFill: {
      height: 6,
      backgroundColor: colors.primary,
      borderRadius: 3,
    },
    timeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    timeText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.secondary,
    },
    controlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.lg,
      marginVertical: theme.spacing.md,
    },
    skipBtn: {
      width: 52,
      height: 52,
      borderRadius: 26,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skipBtnText: {
      fontSize: 9.5,
      fontWeight: '800',
      color: colors.primary,
      marginTop: -2,
    },
    playPauseBtn: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
    },
    speedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.sm,
    },
    speedLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    rateBtn: {
      minHeight: 36,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rateBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    rateBtnText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.text,
    },
    rateBtnTextActive: {
      color: colors.onPrimary,
    },
    backgroundNotice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      padding: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      backgroundColor: colors.primaryContainer,
      borderWidth: 1,
      borderColor: colors.border,
    },
    backgroundNoticeTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.onPrimaryContainer,
    },
    backgroundNoticeBody: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.onPrimaryContainer,
    },
  });
}
