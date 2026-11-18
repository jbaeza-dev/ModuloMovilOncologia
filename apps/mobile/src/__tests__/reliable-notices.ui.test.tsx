import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';

import { needsBatteryGuide, ReliableNoticesCard } from '../features/reminders/ReliableNoticesCard';

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({
    theme: {
      colorScheme: 'light',
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
    },
  }),
}));

const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

describe('Guía para que los avisos lleguen siempre (ahorro de batería)', () => {
  afterEach(() => {
    setOS(originalOS);
    jest.restoreAllMocks();
  });

  it('reconoce las marcas con ahorro de batería agresivo', () => {
    expect(needsBatteryGuide('Xiaomi Redmi')).toBe(true);
    expect(needsBatteryGuide('samsung')).toBe(true);
    expect(needsBatteryGuide('Google')).toBe(false);
    expect(needsBatteryGuide('')).toBe(false);
    expect(needsBatteryGuide(undefined)).toBe(false);
  });

  it('en Preferencias explica los dos ajustes y abre los ajustes de QuimioCare', async () => {
    setOS('android');
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<ReliableNoticesCard manufacturer="Google" />);
    expect(screen.getByText('Para que tus avisos lleguen siempre')).toBeTruthy();
    expect(screen.getByText(/«Sin restricciones»/)).toBeTruthy();
    expect(screen.getByText(/«Autoencendido en segundo plano»/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Abrir ajustes de QuimioCare' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('en Mis recordatorios aparece solo en marcas que lo necesitan', async () => {
    setOS('android');
    const { rerender } = await render(
      <ReliableNoticesCard onlyWhenNeeded manufacturer="Google Pixel" />,
    );
    expect(screen.queryByText('Para que tus avisos lleguen siempre')).toBeNull();
    await rerender(<ReliableNoticesCard onlyWhenNeeded manufacturer="Xiaomi Redmi" />);
    expect(screen.getByText('Para que tus avisos lleguen siempre')).toBeTruthy();
  });

  it('no se muestra fuera de Android', async () => {
    setOS('ios');
    await render(<ReliableNoticesCard manufacturer="Xiaomi" />);
    expect(screen.queryByText('Para que tus avisos lleguen siempre')).toBeNull();
  });
});
