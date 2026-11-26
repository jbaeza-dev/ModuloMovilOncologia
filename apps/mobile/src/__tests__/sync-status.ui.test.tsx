/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { SessionSnapshot } from '../services/session/http-session-types';
import type { SyncSummary } from '../features/sync/sync-presentation';
const mockNavigate = jest.fn();
const mockRefresh = jest.fn();
const mockAccept = jest.fn();
let mockState: SessionSnapshot;
let mockSummary: SyncSummary | null;
jest.mock('expo-router', () => ({ router: { push: (path: string) => mockNavigate(path) } }));
jest.mock('../features/access/SessionScreens', () => ({
  useIdentity: () => ({
    snapshot: mockState,
    data: { patientId: 'synthetic' },
    session: { config: { mode: 'demo' }, refreshIdentity: mockRefresh, acceptTerms: mockAccept },
  }),
}));
jest.mock('../features/sync/ClinicalSyncNotice', () => ({
  useClinicalSyncSummary: () => ({ summary: mockSummary }),
}));
jest.mock('../components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const mockTrigger = jest.fn();
let mockStore: unknown = null;
const mockList = jest.fn();
const mockRetry = jest.fn();
const mockKeep = jest.fn();
jest.mock('../providers/LocalDataProvider', () => ({
  useOptionalLocalData: () => (mockStore ? { clinicalStore: mockStore } : null),
}));
jest.mock('../data/sync/paused-command', () => ({
  listSetAside: (...args: unknown[]) => mockList(...args),
  retrySetAside: (...args: unknown[]) => mockRetry(...args),
  keepSetAsideOnPhone: (...args: unknown[]) => mockKeep(...args),
}));
jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: { colors: { surface: '#fff', primary: '#00695c', text: '#222' } } }),
}));
import { RecordsStatusCard, SyncStatusScreen } from '../features/sync/GlobalStatusNotice';
beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue(undefined);
  mockState = {
    state: 'context_ready',
    user: { id: 'synthetic', name: 'Prueba', isDemo: true },
    identity: null,
    stale: false,
    uploadAllowed: true,
    terms: null,
    consent: null,
    message: null,
    revision: 0,
  };
  mockSummary = { pending: 0, paused: 0, rejected: 0, runtimePaused: false, pauseCode: null };
  mockStore = null;
  mockList.mockResolvedValue([aside]);
  mockRetry.mockResolvedValue(undefined);
  mockKeep.mockResolvedValue(undefined);
  mockTrigger.mockResolvedValue(undefined);
});
const aside = {
  id: 'ed21a163-0102-4b25-98af-4b3552cc87ad',
  kind: 'signos' as const,
  capturedAt: '2026-11-20T15:30:00.000Z',
  code: 'FORMULARIO_NO_ENCONTRADO',
};
function setAsideStore() {
  return { connection: 'connection', scope: 'scope', triggerPendingUpload: mockTrigger };
}
describe('Tarjeta de registros con acciones directas', () => {
  it('muestra el estado en una tarjeta normal y permite consultar el detalle', async () => {
    await render(<RecordsStatusCard />);
    expect(screen.getByText('No tienes registros pendientes de envío.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver estado de mis registros' }));
    expect(mockNavigate).toHaveBeenCalledWith('/perfil/estado-envios');
    expect(screen.queryByText(/Envíos pausados/)).toBeNull();
  });
  it('ofrece la recuperación de conexión en el mismo lugar sin navegar por sesión y permisos', async () => {
    mockState = { ...mockState, state: 'service_unavailable', stale: true, uploadAllowed: false };
    await render(<RecordsStatusCard />);
    await fireEvent.press(screen.getByRole('button', { name: 'Intentar ahora' }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
  });
  it('borra el aviso de un intento fallido cuando la conexión se recupera', async () => {
    mockState = { ...mockState, state: 'service_unavailable', stale: true, uploadAllowed: false };
    mockRefresh.mockRejectedValueOnce(new Error('sin servidor'));
    const view = await render(<RecordsStatusCard />);
    await fireEvent.press(screen.getByRole('button', { name: 'Intentar ahora' }));
    expect(await screen.findByText(/No pudimos completar la conexión/)).toBeTruthy();
    mockState = { ...mockState, state: 'context_ready', stale: false, uploadAllowed: true };
    await view.rerender(<RecordsStatusCard />);
    expect(screen.getByText('No tienes registros pendientes de envío.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/No pudimos completar la conexión/)).toBeNull());
  });
  it('dirige al consentimiento pendiente en una sola acción, sin aceptarlo automáticamente', async () => {
    mockState = { ...mockState, state: 'terms_pending', uploadAllowed: false };
    await render(<RecordsStatusCard />);
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar consentimiento' }));
    expect(mockNavigate).toHaveBeenCalledWith('/perfil/consentimientos');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
  });
  it('pide acceso explícito si la renovación ya no es válida', async () => {
    mockState = { ...mockState, state: 'expired', stale: true, uploadAllowed: false };
    await render(<RecordsStatusCard />);
    await fireEvent.press(screen.getByRole('button', { name: 'Volver a ingresar' }));
    expect(mockNavigate).toHaveBeenCalledWith('/acceso/seleccionar-paciente');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
  it('un error técnico del registro no se presenta como un problema que deba resolver actualizando sesión', async () => {
    mockSummary = {
      pending: 0,
      paused: 1,
      rejected: 0,
      runtimePaused: true,
      pauseCode: 'SNAPSHOT_FUERA_CONTRATO',
    };
    await render(<RecordsStatusCard />);
    expect(screen.getByText('Un registro necesita revisión')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Intentar ahora' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revisar sesión' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver registro y detalles' }));
    expect(mockNavigate).toHaveBeenCalledWith('/perfil/estado-envios');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
  it('el detalle ofrece la acción apropiada sin un enlace recursivo a otra pantalla de estado', async () => {
    mockSummary = { pending: 1, paused: 0, rejected: 1, runtimePaused: false, pauseCode: null };
    await render(<SyncStatusScreen />);
    expect(screen.getByText(/1 registro no fue aceptado/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ver registros' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Consultar historial de signos' })).toBeTruthy();
  });
  it('lista el registro apartado y pide confirmar antes de reintentar su envío', async () => {
    mockStore = setAsideStore();
    await render(<SyncStatusScreen />);
    expect(await screen.findByText(/Signos vitales del/)).toBeTruthy();
    expect(screen.getByText(/no detienen el envío de los demás/)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: /^Reintentar el envío de Signos vitales/ }),
    );
    expect(mockRetry).not.toHaveBeenCalled();
    expect(screen.getByText(/Si ya había llegado, no se duplicará/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Confirmar reintento de/ }));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('connection', 'scope', aside.id));
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    expect(mockKeep).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('set-aside-records')).toBeNull());
  });
  it('conservar en el teléfono también pide confirmación y se puede cancelar', async () => {
    mockStore = setAsideStore();
    await render(<SyncStatusScreen />);
    await screen.findByText(/Signos vitales del/);
    await fireEvent.press(
      screen.getByRole('button', { name: /^Conservar solo en este teléfono Signos/ }),
    );
    expect(screen.getByText(/no se enviará a tu equipo de salud/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mockKeep).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: /^Conservar solo en este teléfono Signos/ }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: /^Confirmar conservar solo en este teléfono/ }),
    );
    await waitFor(() => expect(mockKeep).toHaveBeenCalledWith('connection', 'scope', aside.id));
    expect(mockRetry).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });
  it('si la acción falla, conserva el registro y lo explica', async () => {
    mockStore = setAsideStore();
    mockRetry.mockRejectedValueOnce(new Error('sin base'));
    await render(<SyncStatusScreen />);
    await screen.findByText(/Signos vitales del/);
    await fireEvent.press(
      screen.getByRole('button', { name: /^Reintentar el envío de Signos vitales/ }),
    );
    await fireEvent.press(screen.getByRole('button', { name: /^Confirmar reintento de/ }));
    expect(await screen.findByText(/El registro sigue guardado en este teléfono/)).toBeTruthy();
    expect(screen.getByTestId('set-aside-' + aside.id)).toBeTruthy();
  });
  it('sin registros apartados no muestra la lista', async () => {
    mockStore = setAsideStore();
    mockList.mockResolvedValue([]);
    await render(<SyncStatusScreen />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.queryByTestId('set-aside-records')).toBeNull();
  });
  it('no mezcla una tarjeta de cuenta anterior cuando ya no existe sesión', async () => {
    mockState = { ...mockState, user: null, state: 'no_identity' };
    await render(<RecordsStatusCard />);
    expect(screen.queryByTestId('records-status-card')).toBeNull();
  });
});
