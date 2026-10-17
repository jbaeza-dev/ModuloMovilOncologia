/// <reference types="jest" />

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

let mockNavIndex = 0;
const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterNavigate = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterCanGoBack = jest.fn(() => mockNavIndex > 0);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: {
      back: (...args: unknown[]) => mockRouterBack(...args),
      replace: (...args: unknown[]) => mockRouterReplace(...args),
      navigate: (...args: unknown[]) => mockRouterNavigate(...args),
      push: (...args: unknown[]) => mockRouterPush(...args),
      canGoBack: () => mockRouterCanGoBack(),
    },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        return cb();
      }, [cb]);
    },
    Tabs: Object.assign(({ children }: { children: React.ReactNode }) => children, {
      Screen: () => null,
    }),
  };
});

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) =>
    selector({ index: mockNavIndex }),
  StackActions: {
    popToTop: () => ({ type: 'POP_TO_TOP' }),
  },
}));

const mockTheme = {
  colors: {
    background: '#FFFFFF',
    surface: '#F5F5F5',
    mutedSurface: '#E0E0E0',
    primary: '#00695C',
    onPrimary: '#FFFFFF',
    primaryContainer: '#E0F2EF',
    onPrimaryContainer: '#183B36',
    border: '#D0D0D0',
    text: '#212121',
    secondary: '#555555',
    error: '#D32F2F',
    errorContainer: '#FFEBEE',
    onErrorContainer: '#B71C1C',
    success: '#388E3C',
    warning: '#F57C00',
    pressed: '#E0E0E0',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18, full: 9999 },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../utils/environment', () => ({
  isDemoMode: () => true,
}));

const mockUseLocalData = jest.fn().mockReturnValue({
  patientId: 'paciente-demo-001',
  repository: {
    latestVital: jest.fn().mockResolvedValue(null),
    createVitals: jest.fn().mockResolvedValue(undefined),
  },
  changePatient: jest.fn(),
  runSave: jest.fn((fn: () => Promise<unknown>) => fn()),
  saving: false,
  isClosing: false,
});

jest.mock('../providers/LocalDataProvider', () => ({
  DEMO_PATIENTS: [
    { id: 'paciente-demo-001', label: 'Paciente de prueba A' },
    { id: 'paciente-demo-002', label: 'Paciente de prueba B' },
  ],
  useLocalData: () => mockUseLocalData(),
}));

import { handleHomeTabPress } from '../app/(tabs)/_layout';
import { NavigationCard } from '../components/NavigationCard';
import { Screen } from '../components/Screen';
import { HomeScreen } from '../features/home/HomeScreen';
import { clearHomeScrollToTop, consumeHomeScrollToTop } from '../features/home/home-scroll-signal';
import { RegisterVitalsDataScreen } from '../features/vitals/VitalsDataScreens';

describe('Screen, NavigationCard, rutas de Inicio y reinicio dirigido (Bloque 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavIndex = 0;
    clearHomeScrollToTop();
  });

  it('oculta la flecha Volver cuando no hay historial de retroceso (index === 0)', async () => {
    mockNavIndex = 0;
    await render(
      <Screen title="Pantalla sin historial">
        <Text>Contenido</Text>
      </Screen>,
    );

    expect(screen.queryByLabelText('Volver')).toBeNull();
  });

  it('oculta la flecha Volver cuando isRoot es true aunque exista historial en el navegador', async () => {
    mockNavIndex = 2;
    await render(
      <Screen isRoot title="Pantalla raíz">
        <Text>Contenido raíz</Text>
      </Screen>,
    );

    expect(screen.queryByLabelText('Volver')).toBeNull();
  });

  it('muestra la flecha Volver cuando no es raíz y existe historial, e invoca exclusivamente router.back()', async () => {
    mockNavIndex = 1;
    await render(
      <Screen title="Pantalla secundaria">
        <Text>Contenido secundario</Text>
      </Screen>,
    );

    const backButton = screen.getByLabelText('Volver');
    expect(backButton).toBeTruthy();

    await fireEvent.press(backButton);

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('NavigationCard usa navigate por defecto, push cuando navigationMethod="push" y replace cuando replace=true', async () => {
    await render(
      <>
        <NavigationCard title="Acceso navigate" icon="clock" href="/recordatorios" />
        <NavigationCard
          title="Acceso push"
          icon="activity"
          href="/(tabs)/(inicio)/registrar-vitales"
          navigationMethod="push"
        />
        <NavigationCard title="Acceso replace" icon="home" href="/" replace />
      </>,
    );

    await fireEvent.press(screen.getByLabelText('Acceso navigate'));
    expect(mockRouterNavigate).toHaveBeenCalledWith('/recordatorios', { withAnchor: true });

    await fireEvent.press(screen.getByLabelText('Acceso push'));
    expect(mockRouterPush).toHaveBeenCalledWith('/(tabs)/(inicio)/registrar-vitales');

    await fireEvent.press(screen.getByLabelText('Acceso replace'));
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });

  it('HomeScreen hace push a /(tabs)/(inicio)/registrar-vitales y /(tabs)/(inicio)/registrar-sintomas y oculta Volver por ser raíz', async () => {
    mockNavIndex = 1;
    await render(<HomeScreen />);

    expect(screen.queryByLabelText('Volver')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Registrar signos vitales'));
    expect(mockRouterPush).toHaveBeenCalledWith('/(tabs)/(inicio)/registrar-vitales');

    await fireEvent.press(screen.getByLabelText('Registrar síntomas'));
    expect(mockRouterPush).toHaveBeenCalledWith('/(tabs)/(inicio)/registrar-sintomas');
  });

  it('RegisterVitalsDataScreen distingue flecha Volver (router.back) de Ver historial de mediciones (router.navigate)', async () => {
    mockNavIndex = 1;
    await render(<RegisterVitalsDataScreen />);

    await fireEvent.press(screen.getByLabelText('Volver'));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterNavigate).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Ver historial de mediciones'));
    expect(mockRouterNavigate).toHaveBeenCalledWith('/vitales');
  });

  it('handleHomeTabPress despacha popToTop dirigido solo a la pila de (inicio) cuando index > 0 y solicita scroll a y=0', () => {
    const dispatch = jest.fn();
    handleHomeTabPress({
      getState: () => ({
        routes: [
          {
            name: '(inicio)',
            state: {
              key: 'stack-inicio-key-123',
              index: 2,
              routes: [
                { name: 'index' },
                { name: 'perfil/index' },
                { name: 'perfil/preferencias' },
              ],
            },
          },
          {
            name: 'vitales',
            state: {
              key: 'stack-vitales-key-456',
              index: 1,
              routes: [{ name: 'index' }, { name: 'detalle' }],
            },
          },
        ],
      }),
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'POP_TO_TOP',
      target: 'stack-inicio-key-123',
    });
    expect(consumeHomeScrollToTop()).toBe(true);
  });

  it('handleHomeTabPress no despacha popToTop cuando la pila de (inicio) está en su raíz o aún no existe', () => {
    const dispatch = jest.fn();
    handleHomeTabPress({
      getState: () => ({
        routes: [
          {
            name: '(inicio)',
            state: {
              key: 'stack-inicio-key-123',
              index: 0,
              routes: [{ name: 'index' }],
            },
          },
        ],
      }),
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(consumeHomeScrollToTop()).toBe(true);

    // Pila aún no creada por carga diferida
    handleHomeTabPress({
      getState: () => ({
        routes: [{ name: '(inicio)' }],
      }),
      dispatch,
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(consumeHomeScrollToTop()).toBe(true);
  });
});
