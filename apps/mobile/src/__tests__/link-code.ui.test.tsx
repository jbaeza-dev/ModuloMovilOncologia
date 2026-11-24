/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockRead = jest.fn();
const mockGenerate = jest.fn();
const mockFactory = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));
jest.mock('../components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: { colors: { primary: '#00695c' } } }),
}));
jest.mock('../data/local/clinical-context/refresh-medical-team', () => ({
  refreshMedicalTeam: jest.fn(async () => undefined),
}));
jest.mock('../data/local/repository', () => ({
  formatDate: (value: string) => 'fecha:' + value.slice(0, 10),
}));
jest.mock('../services/session/link-code-client', () => ({
  createLinkCodeClient: (...args: unknown[]) => {
    mockFactory(...args);
    return { read: mockRead, generate: mockGenerate };
  },
}));
// Objetos estables entre renders, como los que entrega el proveedor real.
const mockLocal = {
  clinicalStore: { connection: {}, scope: { owner: 'owner', localPatientId: 'patient' } },
  identitySession: { getSnapshot: () => ({ uploadAllowed: true }), refreshIdentity: jest.fn() },
  trackOperation: (work: () => Promise<unknown>) => work(),
  isClosing: false,
  repository: { assignedMedicalTeam: async () => [] },
};
jest.mock('../providers/LocalDataProvider', () => ({ useLocalData: () => mockLocal }));
import { LinkCodeScreen } from '../features/profile/LinkCodeScreen';

const future = new Date(Date.now() + 86_400_000).toISOString();
const uncertain = { kind: 'uncertain', requestedAt: new Date().toISOString(), retryAfter: future };
beforeEach(() => {
  jest.clearAllMocks();
  mockRead.mockResolvedValue({ kind: 'empty' });
});

describe('Pantalla del código de vinculación', () => {
  it('entrega una comprobación de conexión al cliente', async () => {
    await render(<LinkCodeScreen />);
    await waitFor(() => expect(mockFactory).toHaveBeenCalled());
    const isOnline = mockFactory.mock.calls[0]![4] as () => Promise<boolean>;
    await expect(isOnline()).resolves.toBe(true);
  });

  it('sin conexión muestra el motivo y deja pedir el código otra vez', async () => {
    mockGenerate.mockRejectedValueOnce(
      new Error('Sin conexión: no se solicitó ningún código. Inténtalo cuando tengas internet.'),
    );
    await render(<LinkCodeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Solicitar código' }));
    expect(await screen.findByText(/Sin conexión: no se solicitó ningún código/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Solicitar código' })).toBeTruthy();
  });

  it('con la respuesta perdida ofrece intentar de nuevo y muestra el código obtenido', async () => {
    mockRead.mockResolvedValue(uncertain);
    mockGenerate.mockResolvedValueOnce({
      kind: 'known',
      code: 'ABCD1234',
      expiresAt: future,
      requestedAt: new Date().toISOString(),
    });
    await render(<LinkCodeScreen />);
    expect(await screen.findByText(/No recibimos la respuesta del servidor/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(await screen.findByText('ABCD1234')).toBeTruthy();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('ante un código vigente que no llegó, lo explica sin inventar uno', async () => {
    mockRead.mockResolvedValue({ ...uncertain, conflict: true });
    await render(<LinkCodeScreen />);
    expect(await screen.findByText(/Ya existe un código vigente/)).toBeTruthy();
    expect(screen.getByText(/a más tardar el fecha:/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy();
  });
});
