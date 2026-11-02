import { AppIcon as Feather } from './AppIcon';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePodcastPlayback } from '../features/education/PodcastPlaybackContext';
import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export interface PodcastMiniPlayerProps {
  bottomOffset?: number;
}

export function PodcastMiniPlayer({ bottomOffset = 0 }: PodcastMiniPlayerProps) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors, bottomOffset);
  const { currentEpisode, isPlaying, currentTime, duration, togglePlayPause, closePlayer } =
    usePodcastPlayback();

  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      () => setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidHide' : 'keyboardWillHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Ocultamiento ante teclado abierto o si no hay podcast activo
  if (!currentEpisode || keyboardVisible) {
    return null;
  }

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const timeString = `${formatTime(currentTime)} / ${formatTime(duration)}`;

  const handleOpenExpanded = () => {
    router.push('/educacion/podcast-reproductor');
  };

  return (
    <View style={styles.wrapper}>
      {/* Barra de progreso superior delgada */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
      </View>

      <View style={styles.barContainer}>
        {/* Ícono de reproducción o carátula miniatura */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir reproductor completo del podcast"
          onPress={handleOpenExpanded}
          style={styles.artworkMini}
        >
          <Feather
            name={isPlaying ? 'volume-2' : 'disc'}
            size={20}
            color={appTheme.colors.primary}
          />
        </Pressable>

        {/* Información del episodio */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Podcast activo: ${currentEpisode.title}. Tiempo: ${timeString}. Toca para abrir reproductor completo.`}
          onPress={handleOpenExpanded}
          style={styles.infoArea}
        >
          <Text style={styles.episodeTitle} numberOfLines={1}>
            {currentEpisode.title}
          </Text>
          <Text style={styles.timeLabel} numberOfLines={1}>
            {isPlaying ? 'Reproduciendo' : 'Pausado'} · {timeString}
          </Text>
        </Pressable>

        {/* Botón de Reproducir / Pausar */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pausar podcast' : 'Reanudar reproducción'}
          onPress={togglePlayPause}
          style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
        >
          <Feather
            name={isPlaying ? 'pause' : 'play'}
            size={20}
            color={appTheme.colors.onPrimaryContainer}
          />
        </Pressable>

        {/* Botón de Cerrar reproductor */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar reproductor de podcast"
          onPress={closePlayer}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
        >
          <Feather name="x" size={18} color={appTheme.colors.secondary} />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  bottomOffset: number,
) {
  return StyleSheet.create({
    wrapper: {
      position: 'absolute',
      bottom: bottomOffset,
      left: 0,
      right: 0,
      zIndex: 99,
      backgroundColor: colors.surface,
      borderTopWidth: 1.5,
      borderTopColor: colors.border,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      elevation: 6,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    },
    progressTrack: {
      height: 3,
      width: '100%',
      backgroundColor: colors.mutedSurface,
    },
    progressFill: {
      height: 3,
      backgroundColor: colors.primary,
    },
    barContainer: {
      height: 54,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    artworkMini: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.sm,
      backgroundColor: colors.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoArea: {
      flex: 1,
      justifyContent: 'center',
      gap: 2,
    },
    episodeTitle: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.text,
    },
    timeLabel: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.secondary,
    },
    controlBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
