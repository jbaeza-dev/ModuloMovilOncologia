import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useOptionalLocalData } from '../../providers/LocalDataProvider';

export interface PodcastEpisode {
  id: string;
  title: string;
  category: string;
}

export function getDriveAudioStreamUrl(driveId: string): string {
  return `https://docs.google.com/uc?export=download&id=${driveId}`;
}

export interface PodcastPlaybackContextType {
  isConfigured: boolean;
  currentEpisode: PodcastEpisode | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  error: string | null;
  playEpisode: (episode: PodcastEpisode) => Promise<void>;
  pause: () => void;
  resume: () => void;
  togglePlayPause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  skipForward: (seconds?: number) => Promise<void>;
  skipBackward: (seconds?: number) => Promise<void>;
  setRate: (rate: number) => void;
  closePlayer: () => void;
}

const PodcastPlaybackContext = createContext<PodcastPlaybackContextType | null>(null);

let audioModeConfigured = false;

async function ensureAudioMode() {
  if (audioModeConfigured) return;
  try {
    await setAudioModeAsync({
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      playsInSilentMode: true,
    });
    audioModeConfigured = true;
  } catch {
    // Silently continue if native audio module is stubbed in test/web
  }
}

export function PodcastPlaybackProvider({ children }: { children: ReactNode }) {
  const localData = useOptionalLocalData();
  const patientId = localData?.patientId ?? null;
  const isClosing = localData?.isClosing ?? false;

  const [currentEpisode, setCurrentEpisode] = useState<PodcastEpisode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const activePatientRef = useRef<string | null>(patientId);

  const cleanupPlayer = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.setActiveForLockScreen(false);
        playerRef.current.pause();
        playerRef.current.remove();
      } catch {
        // ignore
      }
      playerRef.current = null;
    }
    setCurrentEpisode(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, []);

  // Detener audio, liberar controles de bloqueo y limpiar estado al cerrar sesión o cambiar de paciente
  useEffect(() => {
    if (
      !patientId ||
      isClosing ||
      (activePatientRef.current && activePatientRef.current !== patientId)
    ) {
      cleanupPlayer();
    }
    activePatientRef.current = patientId;
  }, [patientId, isClosing, cleanupPlayer]);

  // Limpiar reproductor al desmontar contexto global
  useEffect(() => {
    return () => {
      cleanupPlayer();
    };
  }, [cleanupPlayer]);

  const playEpisode = useCallback(async (episode: PodcastEpisode) => {
    setError(null);
    await ensureAudioMode();

    try {
      // Si ya hay un reproductor activo, limpiar su estado anterior
      if (playerRef.current) {
        try {
          playerRef.current.setActiveForLockScreen(false);
          playerRef.current.pause();
          playerRef.current.remove();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }

      setCurrentEpisode(episode);
      setCurrentTime(0);
      setDuration(0);
      setIsBuffering(true);

      const streamUrl = getDriveAudioStreamUrl(episode.id);
      const player = createAudioPlayer(streamUrl);
      playerRef.current = player;

      player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        setIsPlaying(status.playing);
        setCurrentTime(status.currentTime);
        if (status.duration && status.duration > 0) {
          setDuration(status.duration);
        }
        setIsBuffering(status.isBuffering);
      });

      player.setActiveForLockScreen(true, {
        title: episode.title,
        artist: 'QuimioCare · CUIDAQUIMIO',
      });

      player.play();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'No se pudo iniciar la reproducción del podcast en este dispositivo.',
      );
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }, []);

  const pause = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        setIsPlaying(false);
      } catch {
        // ignore
      }
    }
  }, []);

  const resume = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.play();
        setIsPlaying(true);
      } catch {
        // ignore
      }
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [isPlaying, pause, resume]);

  const seekTo = useCallback(async (seconds: number) => {
    if (playerRef.current) {
      try {
        await playerRef.current.seekTo(seconds);
        setCurrentTime(seconds);
      } catch {
        // ignore
      }
    }
  }, []);

  const skipForward = useCallback(
    async (seconds = 15) => {
      const next = Math.min(duration || Infinity, currentTime + seconds);
      await seekTo(next);
    },
    [currentTime, duration, seekTo],
  );

  const skipBackward = useCallback(
    async (seconds = 15) => {
      const prev = Math.max(0, currentTime - seconds);
      await seekTo(prev);
    },
    [currentTime, seekTo],
  );

  const setRate = useCallback((rate: number) => {
    if (playerRef.current) {
      try {
        playerRef.current.setPlaybackRate(rate);
        setPlaybackRateState(rate);
      } catch {
        // ignore
      }
    }
  }, []);

  const closePlayer = useCallback(() => {
    cleanupPlayer();
  }, [cleanupPlayer]);

  return (
    <PodcastPlaybackContext.Provider
      value={{
        isConfigured: true,
        currentEpisode,
        isPlaying,
        isBuffering,
        currentTime,
        duration,
        playbackRate,
        error,
        playEpisode,
        pause,
        resume,
        togglePlayPause,
        seekTo,
        skipForward,
        skipBackward,
        setRate,
        closePlayer,
      }}
    >
      {children}
    </PodcastPlaybackContext.Provider>
  );
}

const DEFAULT_PODCAST_CONTEXT: PodcastPlaybackContextType = {
  isConfigured: false,
  currentEpisode: null,
  isPlaying: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1.0,
  error: null,
  playEpisode: async () => {},
  pause: () => {},
  resume: () => {},
  togglePlayPause: () => {},
  seekTo: async () => {},
  skipForward: async () => {},
  skipBackward: async () => {},
  setRate: () => {},
  closePlayer: () => {},
};

export function usePodcastPlayback(): PodcastPlaybackContextType {
  const context = useContext(PodcastPlaybackContext);
  return context ?? DEFAULT_PODCAST_CONTEXT;
}
