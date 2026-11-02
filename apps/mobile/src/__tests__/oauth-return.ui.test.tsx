/// <reference types="jest" />
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import OAuthReturn from '../app/acceso/oauth';

const mockIdentity = {
  data: { patientId: null as string | null },
  session: { cancelRequests: jest.fn() },
  snapshot: {
    state: 'authenticating',
    message: null as string | null,
    identity: null as unknown,
    consent: null as unknown,
  },
};
jest.mock('../features/access/SessionScreens', () => ({ useIdentity: () => mockIdentity }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../components/Screen', () => {
  const { View, Text } = jest.requireActual('react-native');
  return {
    Screen: ({ title, children }: { title: string; children: React.ReactNode }) => (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ),
  };
});
jest.mock('../components/Visual', () => {
  const { Text, Pressable } = jest.requireActual('react-native');
  return {
    BodyText: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    VisualButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable role="button" onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockIdentity.data.patientId = null;
  mockIdentity.snapshot = {
    state: 'authenticating',
    message: null,
    identity: null,
    consent: null,
  };
});
afterEach(() => jest.useRealTimers());

it('shows a failed verification and lets the patient return to login', async () => {
  mockIdentity.snapshot = {
    state: 'service_unavailable',
    message: 'Servicio no disponible.',
    identity: null,
    consent: null,
  };
  await render(<OAuthReturn />);
  expect(screen.getByText('Servicio no disponible.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Volver al acceso' }));
  expect(mockIdentity.session.cancelRequests).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/acceso');
});

it('does not remain in an indefinite waiting screen', async () => {
  jest.useFakeTimers();
  await render(<OAuthReturn />);
  expect(screen.getByText('Comprobando acceso')).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(30000);
  });
  expect(screen.getByRole('button', { name: 'Volver al acceso' })).toBeOnTheScreen();
  expect(
    screen.queryByText('Finalizando el acceso con el proveedor central…'),
  ).not.toBeOnTheScreen();
});

it('navigates out of the callback once the patient context is ready', async () => {
  mockIdentity.data.patientId = 'verified-owner';
  await render(<OAuthReturn />);
  expect(router.replace).toHaveBeenCalledWith('/(tabs)');
});

it('navigates to /acceso/completar when profile data is missing', async () => {
  mockIdentity.snapshot = {
    state: 'context_ready',
    message: null,
    identity: { clinicalStatus: 'missing', profile: null },
    consent: null,
  };
  await render(<OAuthReturn />);
  expect(router.replace).toHaveBeenCalledWith('/acceso/completar');
});

it('navigates to /(tabs) when profile has RUT even if clinicalStatus is missing', async () => {
  mockIdentity.data.patientId = 'verified-owner';
  mockIdentity.snapshot = {
    state: 'context_ready',
    message: null,
    identity: {
      clinicalStatus: 'missing',
      profile: { rut: '12.345.678-9', nombre: 'Juan' },
    },
    consent: null,
  };
  await render(<OAuthReturn />);
  expect(router.replace).toHaveBeenCalledWith('/(tabs)');
});

it('navigates to /acceso/consentimientos when consents require acceptance', async () => {
  mockIdentity.snapshot = {
    state: 'context_ready',
    message: null,
    identity: { clinicalStatus: 'available', profile: { rut: '12.345.678-9' } },
    consent: { requiere_aceptacion: true },
  };
  await render(<OAuthReturn />);
  expect(router.replace).toHaveBeenCalledWith('/acceso/consentimientos');
});
