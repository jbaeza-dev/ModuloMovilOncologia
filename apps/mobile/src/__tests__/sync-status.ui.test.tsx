/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
const mockNavigate = jest.fn();
let mockState = { user: { id: 'synthetic' }, state: 'terms_pending' };
let mockSummary = { pending: 1, paused: 0, rejected: 1, runtimePaused: true };
jest.mock('expo-router', () => ({ router: { navigate: (path: string) => mockNavigate(path) } }));
jest.mock('../features/access/SessionScreens', () => ({
  useIdentity: () => ({ snapshot: mockState, data: { patientId: 'synthetic' } }),
  SessionNotice: () => null,
}));
jest.mock('../features/sync/ClinicalSyncNotice', () => ({
  useClinicalSyncSummary: () => ({ summary: mockSummary }),
  ClinicalSyncNotice: () => null,
}));
jest.mock('../components/Screen', () => ({ Screen: () => null }));
jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: { colors: { surface: '#fff', primary: '#00695c' } } }),
}));
import { GlobalStatusNotice } from '../features/sync/GlobalStatusNotice';
describe('Persistent upload status', () => {
  it('keeps pause, pending and rejection visible through one actionable notice', async () => {
    await render(<GlobalStatusNotice />);
    const notice = screen.getByRole('button', {
      name: 'Envíos pausados. 1 registro(s) pendiente(s). 1 registro(s) rechazado(s). Revisar estado.',
    });
    await fireEvent.press(notice);
    expect(mockNavigate).toHaveBeenCalledWith('/perfil/estado-envios');
    expect(screen.queryByText('Reintentar envíos')).toBeNull();
  });
  it('does not announce a warning when the session is ready and the queue has no incident', async () => {
    mockState = { user: { id: 'synthetic' }, state: 'context_ready' };
    mockSummary = { pending: 0, paused: 0, rejected: 0, runtimePaused: false };
    await render(<GlobalStatusNotice />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
