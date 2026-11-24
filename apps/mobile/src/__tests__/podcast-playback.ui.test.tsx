/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';

const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    canGoBack: () => true,
    push: (...args: unknown[]) => mockRouterPush(...args),
    back: () => mockRouterBack(),
  },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactInner = require('react');
    ReactInner.useEffect(() => {
      return cb();
    }, [cb]);
  },
}));

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) => selector({ index: 1 }),
  usePreventRemove: jest.fn(),
}));

const mockTheme = {
  colors: {
    background: '#FFF7E7',
    surface: '#FFFFFF',
    mutedSurface: '#F3EFE6',
    primary: '#006A70',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D1ECE8',
    onPrimaryContainer: '#002022',
    border: '#5C746C',
    inputBorder: '#5C746C',
    inputBorderFocused: '#006A70',
    text: '#191C1D',
    secondary: '#4A6360',
    error: '#BA1A1A',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    success: '#006A70',
    warning: '#7D5700',
    pressed: '#E0E0E0',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18, full: 9999 },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

let mockPatientId: string | null = 'paciente-a';
let mockIsClosing = false;

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => ({
    patientId: mockPatientId,
    isClosing: mockIsClosing,
  }),
  useOptionalLocalData: () => ({
    patientId: mockPatientId,
    isClosing: mockIsClosing,
  }),
}));

// Mock expo-audio
const mockSetAudioModeAsync = jest.fn().mockResolvedValue(undefined);
const mockPlayerPlay = jest.fn();
const mockPlayerPause = jest.fn();
const mockPlayerSeekTo = jest.fn().mockResolvedValue(undefined);
const mockPlayerSetPlaybackRate = jest.fn();
const mockPlayerSetActiveForLockScreen = jest.fn();
const mockPlayerRemove = jest.fn();
const mockPlayerAddListener = jest.fn();

jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
  createAudioPlayer: () => ({
    play: () => mockPlayerPlay(),
    pause: () => mockPlayerPause(),
    seekTo: (sec: number) => mockPlayerSeekTo(sec),
    setPlaybackRate: (rate: number) => mockPlayerSetPlaybackRate(rate),
    setActiveForLockScreen: (active: boolean, meta?: unknown) =>
      meta !== undefined
        ? mockPlayerSetActiveForLockScreen(active, meta)
        : mockPlayerSetActiveForLockScreen(active),
    remove: () => mockPlayerRemove(),
    addListener: (event: string, cb: (status: unknown) => void) => mockPlayerAddListener(event, cb),
  }),
}));

import {
  PodcastPlaybackProvider,
  usePodcastPlayback,
} from '../features/education/PodcastPlaybackContext';
import { PodcastMiniPlayer } from '../components/PodcastMiniPlayer';
import { PodcastPlayerScreen } from '../features/education/PodcastPlayerScreen';

function TestPodcastController() {
  const { playEpisode } = usePodcastPlayback();
  return (
    <Pressable
      testID="trigger-play"
      onPress={() =>
        playEpisode({
          id: '1zWaInWBiNJ-_4XjAiEz5DZ1tIQfs0--7',
          title: 'El Cáncer',
          category: 'Conociendo el Cáncer',
        })
      }
    />
  );
}

// Wrapper con provider para pruebas
function TestPlayerWithProvider({ children }: { children?: React.ReactNode }) {
  return (
    <PodcastPlaybackProvider>
      <TestPodcastController />
      {children}
    </PodcastPlaybackProvider>
  );
}

describe('Podcast Playback & MiniPlayer UI (Etapa 7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PodcastMiniPlayer', () => {
    it('no se dibuja si no hay ningún episodio activo', async () => {
      await render(
        <TestPlayerWithProvider>
          <PodcastMiniPlayer />
        </TestPlayerWithProvider>,
      );

      expect(screen.queryByText(/Reproduciendo/)).toBeNull();
    });

    it('aparece en pantalla cuando se inicia un episodio y permite pausar y navegar al reproductor', async () => {
      await render(
        <TestPlayerWithProvider>
          <PodcastMiniPlayer />
        </TestPlayerWithProvider>,
      );

      // Iniciar reproducción
      await fireEvent.press(screen.getByTestId('trigger-play'));

      await waitFor(() => {
        expect(screen.getByText('El Cáncer')).toBeTruthy();
      });

      // Verifica configuración SDK 57 de audio
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
        playsInSilentMode: true,
      });

      // Verifica controles de pantalla bloqueada Android
      expect(mockPlayerSetActiveForLockScreen).toHaveBeenCalledWith(true, {
        title: 'El Cáncer',
        artist: 'QuimioCare · CUIDAQUIMIO',
      });

      // Navegación al tocar el mini reproductor
      const infoArea = screen.getByLabelText(/Podcast activo: El Cáncer/);
      expect(infoArea).toBeTruthy();
      await fireEvent.press(infoArea);
      expect(mockRouterPush).toHaveBeenCalledWith('/educacion/podcast-reproductor');

      // Botón cerrar
      const closeBtn = screen.getByRole('button', { name: 'Cerrar reproductor de podcast' });
      expect(closeBtn).toBeTruthy();
      await fireEvent.press(closeBtn);

      await waitFor(() => {
        expect(screen.queryByText('El Cáncer')).toBeNull();
      });
    });

    it('detiene la reproducción y libera controles al cerrar sesión o cambiar paciente', async () => {
      mockPatientId = 'paciente-a';
      mockIsClosing = false;

      const { rerender } = await render(
        <TestPlayerWithProvider>
          <PodcastMiniPlayer />
        </TestPlayerWithProvider>,
      );

      // Iniciar reproducción
      await fireEvent.press(screen.getByTestId('trigger-play'));

      await waitFor(() => {
        expect(screen.getByText('El Cáncer')).toBeTruthy();
      });

      // Simular cierre de sesión
      mockPatientId = null;
      rerender(
        <TestPlayerWithProvider>
          <PodcastMiniPlayer />
        </TestPlayerWithProvider>,
      );

      await waitFor(() => {
        expect(screen.queryByText('El Cáncer')).toBeNull();
      });

      expect(mockPlayerSetActiveForLockScreen).toHaveBeenCalledWith(false);
      expect(mockPlayerPause).toHaveBeenCalled();
    });
  });

  describe('PodcastPlayerScreen', () => {
    it('la barra superior y las velocidades bajan de línea si no caben en la pantalla', async () => {
      await render(
        <TestPlayerWithProvider>
          <PodcastPlayerScreen />
        </TestPlayerWithProvider>,
      );
      await fireEvent.press(screen.getByTestId('trigger-play'));
      for (const id of ['podcast-barra-superior', 'podcast-velocidades'])
        expect(StyleSheet.flatten((await screen.findByTestId(id)).props.style).flexWrap).toBe(
          'wrap',
        );
    });

    it('muestra el reproductor ampliado con transportes grandes y selector de velocidad', async () => {
      const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

      await render(
        <TestPlayerWithProvider>
          <PodcastPlayerScreen />
        </TestPlayerWithProvider>,
      );

      // Iniciar episodio
      await fireEvent.press(screen.getByTestId('trigger-play'));

      await waitFor(() => {
        expect(screen.getByText('El Cáncer')).toBeTruthy();
      });

      expect(screen.getByText('Conociendo el Cáncer · CUIDAQUIMIO')).toBeTruthy();
      expect(screen.getByText('Continuidad en segundo plano')).toBeTruthy();

      // Botones de retroceder y adelantar 15 segundos
      const rewBtn = screen.getByRole('button', { name: 'Retroceder 15 segundos' });
      const fwdBtn = screen.getByRole('button', { name: 'Adelantar 15 segundos' });
      expect(rewBtn).toBeTruthy();
      expect(fwdBtn).toBeTruthy();

      await fireEvent.press(fwdBtn);
      await fireEvent.press(rewBtn);

      // Selectores de velocidad 1.0x, 1.25x, 1.5x
      const rate125 = screen.getByRole('button', { name: 'Velocidad 1.25x' });
      expect(rate125).toBeTruthy();
      await fireEvent.press(rate125);

      expect(mockPlayerSetPlaybackRate).toHaveBeenCalledWith(1.25);
      expect(announceSpy).toHaveBeenCalledWith('Velocidad cambiada a 1.25x.');

      announceSpy.mockRestore();
    });
  });
});
