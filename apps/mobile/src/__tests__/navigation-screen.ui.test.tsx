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

jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    canGoBack: () => mockRouterCanGoBack(),
  },
}));

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) =>
    selector({ index: mockNavIndex }),
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

import { Screen } from '../components/Screen';

describe('Screen: navegación reactiva y pantallas raíz (Bloque 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavIndex = 0;
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
});
