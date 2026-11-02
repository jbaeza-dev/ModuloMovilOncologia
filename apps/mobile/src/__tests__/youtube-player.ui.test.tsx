/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

const mockRouterPush = jest.fn();
const mockRouterNavigate = jest.fn();
const mockRouterBack = jest.fn();

let mockSearchParams: Record<string, string> = {
  videoId: 'dQw4w9WgXcQ',
  title: '¿Qué esperar en tu primera sesión de quimioterapia?',
  description: 'Recomendaciones prácticas desde la sala de quimioterapia.',
  version: '1.0',
};

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    replace: jest.fn(),
    canGoBack: () => true,
    back: () => mockRouterBack(),
  },
  useLocalSearchParams: () => mockSearchParams,
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

let mockNetworkState = {
  isConnected: true,
  isInternetReachable: true,
};

jest.mock('expo-network', () => ({
  getNetworkStateAsync: () => Promise.resolve(mockNetworkState),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastWebViewProps: any = null;

jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WebView: (props: any) => {
      lastWebViewProps = props;
      return <View testID="mock-youtube-webview" {...(props as object)} />;
    },
  };
});

const mockRecordYouTubeInteraction = jest.fn().mockResolvedValue(undefined);

const mockRepository = {
  education: {
    recordYouTubeInteraction: (...args: unknown[]) => mockRecordYouTubeInteraction(...args),
  },
};

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => ({
    patientId: 'paciente-a',
    repository: mockRepository,
    isClosing: false,
  }),
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

import { YouTubePlayerScreen } from '../features/education/YouTubePlayerScreen';

describe('YouTube Player Screen UI (Etapa 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNetworkState = {
      isConnected: true,
      isInternetReachable: true,
    };
    mockSearchParams = {
      videoId: 'dQw4w9WgXcQ',
      title: '¿Qué esperar en tu primera sesión de quimioterapia?',
      description: 'Recomendaciones prácticas desde la sala de quimioterapia.',
      version: '1.0',
    };
  });

  it('muestra el reproductor de YouTube en línea con WebView y coordinación de audio', async () => {
    await render(<YouTubePlayerScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-youtube-webview')).toBeTruthy();
    });

    expect(screen.getByText('¿Qué esperar en tu primera sesión de quimioterapia?')).toBeTruthy();
    expect(screen.getByText('Contenido educativo')).toBeTruthy();
    expect(screen.getByText('Audio coordinado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeTruthy();

    // Verifica que se registre la interacción analítica en SQLite
    expect(mockRecordYouTubeInteraction).toHaveBeenCalledWith({
      contentId: 'dQw4w9WgXcQ',
      youtubeVideoId: 'dQw4w9WgXcQ',
      versionOrigen: '1.0',
    });

    // Verifica la identificación de cliente baseUrl y Referer verificable institucional
    expect(lastWebViewProps.source).toMatchObject({
      baseUrl: 'https://parra.chillan.ubiobio.cl',
      headers: { Referer: 'https://parra.chillan.ubiobio.cl' },
    });
  });

  it('permite alternar entre modo normal y pantalla completa horizontal', async () => {
    const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    await render(<YouTubePlayerScreen />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeTruthy();
    });

    // Activar pantalla completa
    await fireEvent.press(screen.getByRole('button', { name: 'Pantalla completa' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Salir de pantalla completa' })).toBeTruthy();
    });

    expect(announceSpy).toHaveBeenCalledWith('Modo de pantalla completa activado.');
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );

    // Salir de pantalla completa
    await fireEvent.press(screen.getByRole('button', { name: 'Salir de pantalla completa' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeTruthy();
    });

    expect(announceSpy).toHaveBeenCalledWith(
      'Pantalla completa desactivada, volviendo a vista vertical.',
    );
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );

    announceSpy.mockRestore();
  });

  it('muestra aviso explicativo amigable cuando el dispositivo no tiene internet', async () => {
    mockNetworkState = {
      isConnected: false,
      isInternetReachable: false,
    };

    await render(<YouTubePlayerScreen />);

    await waitFor(() => {
      expect(screen.getByText('Este video requiere conexión a internet')).toBeTruthy();
    });

    expect(
      screen.getByText(
        /Los videos educativos requieren conexión a internet. Puedes revisar las guías y podcasts que ya tienes descargados/,
      ),
    ).toBeTruthy();

    expect(screen.getByText('Ir a Podcasts CUIDAQUIMIO')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ir a Podcasts CUIDAQUIMIO'));
    expect(mockRouterPush).toHaveBeenCalledWith('/educacion/podcasts');
  });

  it('distingue eventos de reproducción efectiva y error de restricción de inserción (101/150)', async () => {
    await render(<YouTubePlayerScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-youtube-webview')).toBeTruthy();
    });

    // Estado inicial: Conectando
    expect(screen.getByText('Conectando…')).toBeTruthy();

    // 1. Simular reproducción efectiva (YT_STATE: 1)
    await fireEvent(screen.getByTestId('mock-youtube-webview'), 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'YT_STATE', state: 1 }) },
    });

    await waitFor(() => {
      expect(screen.getByText('Reproduciendo')).toBeTruthy();
    });

    // 2. Simular error de restricción de inserción (YT_ERROR: 101)
    await fireEvent(screen.getByTestId('mock-youtube-webview'), 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'YT_ERROR', code: 101 }) },
    });

    await waitFor(() => {
      expect(screen.getByText('Video con restricción de inserción')).toBeTruthy();
    });

    expect(screen.getByText('Inserción restringida')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Abrir en YouTube' }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
