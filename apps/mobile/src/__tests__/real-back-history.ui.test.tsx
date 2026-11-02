/// <reference types="jest" />
import React from 'react';
import { Text } from 'react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Screen } from '../components/Screen';
import { NavigationCard } from '../components/NavigationCard';
import TabsLayout from '../app/(tabs)/_layout';

jest.mock('../components/PodcastMiniPlayer', () => ({ PodcastMiniPlayer: () => null }));
jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({
    theme: {
      colorScheme: 'light',
      colors: {
        background: '#fff',
        surface: '#fff',
        text: '#111',
        primary: '#006A70',
        border: '#777',
        secondary: '#444',
      },
    },
  }),
}));

const Layout = () => <Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
const context = {
  _layout: Layout,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/(inicio)/_layout': Layout,
  '(tabs)/educacion/_layout': Layout,
  '(tabs)/vitales/_layout': Layout,
  '(tabs)/formulario/_layout': Layout,
  '(tabs)/(inicio)/index': () => (
    <Screen isRoot title="Origen Inicio">
      <NavigationCard title="Abrir reportes" icon="file-text" href="/vitales/reportes" />
    </Screen>
  ),
  '(tabs)/educacion/index': () => (
    <Screen isRoot title="Origen Educación">
      <NavigationCard title="Abrir perfil" icon="user" href="/perfil" />
    </Screen>
  ),
  '(tabs)/vitales/index': () => <Text>Mediciones</Text>,
  '(tabs)/formulario/index': () => <Text>Formulario</Text>,
  'perfil/_layout': Layout,
  'perfil/index': () => (
    <Screen title="Detalle Perfil">
      <Text>Cuenta</Text>
    </Screen>
  ),
  'vitales/_layout': Layout,
  'vitales/reportes': () => (
    <Screen title="Mis reportes">
      <NavigationCard title="Abrir PDF" icon="file-text" href="/reportes/visor-pdf" />
    </Screen>
  ),
  'reportes/_layout': Layout,
  'reportes/visor-pdf': () => (
    <Screen title="Visor PDF">
      <Text>Documento</Text>
    </Screen>
  ),
};
afterEach(() => jest.useRealTimers());
it('returns from a detail at local index zero to the actual Education origin', async () => {
  const result = renderRouter(context, { initialUrl: '/educacion' });
  await result;
  await fireEvent.press(await screen.findByRole('button', { name: 'Abrir perfil' }));
  await waitFor(() => expect(result.getPathname()).toBe('/perfil'));
  await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
  await waitFor(() => expect(result.getPathname()).toBe('/educacion'));
  expect(screen.getByText('Origen Educación')).toBeTruthy();
});
it('returns PDF → reportes → Inicio without inserting the Mediciones tab', async () => {
  const result = renderRouter(context, { initialUrl: '/' });
  await result;
  await fireEvent.press(await screen.findByRole('button', { name: 'Abrir reportes' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Abrir PDF' }));
  await waitFor(() => expect(result.getPathname()).toBe('/reportes/visor-pdf'));
  await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
  await waitFor(() => expect(result.getPathname()).toBe('/vitales/reportes'));
  await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
  await waitFor(() => expect(result.getPathname()).toBe('/'));
});
