/// <reference types="jest" />
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { SessionSnapshot } from '../services/session/http-session-types';
const fetchedAt = '2026-11-25T18:51:18.648Z';
const snapshot = {
  state: 'context_ready',
  user: { id: 'synthetic', name: 'Prueba', isDemo: false },
  identity: { fetchedAt },
  stale: false,
  uploadAllowed: true,
  terms: null,
  consent: null,
  message: null,
  revision: 0,
} as unknown as SessionSnapshot;
const mockData = {
  identitySession: { subscribe: () => () => undefined, getSnapshot: () => snapshot },
};
jest.mock('../providers/LocalDataProvider', () => ({ useOptionalLocalData: () => mockData }));
jest.mock('../services/session/native-session', () => ({ registerNativePush: jest.fn() }));
jest.mock('../components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveTheme } = require('../theme');
    return { theme: resolveTheme('turquoise', 'light') };
  },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
import { IdentityScreen } from '../features/access/SessionScreens';
import { formatDate } from '../data/local/repository';

describe('Sesión y permisos', () => {
  it('muestra la última consulta como fecha legible y no en formato técnico', async () => {
    await render(<IdentityScreen />);
    expect(screen.getByText(formatDate(fetchedAt))).toBeTruthy();
    expect(screen.queryByText(fetchedAt)).toBeNull();
  });
});
