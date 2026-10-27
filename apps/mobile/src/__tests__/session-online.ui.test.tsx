/// <reference types="jest" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { HttpSessionAdapter, DEMO_AUTH_IDS } from '../services/session/http-session-adapter';
import { DEMO_USERS } from '../services/session/demo-session-adapter';
import { sessionConfig } from '../services/session/session-config';
import type { CredentialVault } from '../services/session/credential-vault';
const mockData: { identitySession: HttpSessionAdapter | null } = { identitySession: null };
jest.mock('../providers/LocalDataProvider', () => ({ useOptionalLocalData: () => mockData }));
jest.mock('../services/session/native-session', () => ({ registerNativePush: jest.fn() }));
jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveTheme } = require('../theme');
    return { theme: resolveTheme('turquoise', 'light') };
  },
}));
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), canGoBack: () => false, back: jest.fn() },
}));
jest.mock('expo-router/react-navigation', () => ({ useNavigationState: () => false }));
import { OnlineConsentScreen } from '../features/access/SessionScreens';
const owner = DEMO_AUTH_IDS[0],
  term = '8fa30249-41a0-434f-a624-36dfba1c0cd1',
  operation = 'e2f21f9e-9ab1-439c-93b7-9d24e3f52410';
const config = sessionConfig({
  APP_ENV: 'demo',
  CLINICAL_URL: 'http://clinical.test',
  GATEWAY_URL: 'http://gateway.test',
  AUTH_ISSUER: 'quimiocare-demo',
  AUTH_AUDIENCE: 'authenticated',
})!;
async function setup(revoked = false) {
  const values = new Map<string, string>(),
    vault: CredentialVault = {
      read: async (k) => values.get(k) ?? null,
      write: async (k, v) => {
        values.set(k, v);
      },
      remove: async (k) => {
        values.delete(k);
      },
    };
  let required = true;
  const bodies: Record<string, unknown>[] = [];
  const definition = {
    id: term,
    codigo: 'TERMINOS_PLATAFORMA',
    version: '1.0',
    titulo: 'Términos de prueba online',
    texto_completo: 'Documento técnico sintético.',
    vigente_desde: '2026-01-01',
    obligatorio: true,
  };
  const current = {
    id: operation,
    paciente_id: owner,
    definicion_terminos_id: term,
    otorgado_el: '2026-10-26T12:00:00Z',
    revocado: revoked,
  };
  const fake: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    let value: unknown;
    if (path === '/__demo/auth/session')
      value = {
        access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: owner, paciente_demo: 'A' },
      };
    else if (path === '/api/v1/auth/me')
      value = {
        id: owner,
        email: 'synthetic@example.com',
        nombre: 'Cuenta A',
        rol: 'paciente',
        activo: true,
        estado_incorporacion: 'COMPLETO',
      };
    else if (path.endsWith('perfil-clinico'))
      value = {
        id: '4fc1c087-950d-488d-ad2e-d993ea5ca4cd',
        fecha_actualizacion: '2026-10-26T12:00:00Z',
      };
    else if (path.endsWith('tratamiento-activo'))
      value = {
        id: '8cc30741-9a08-4efb-9369-d88f52c097be',
        tipo_tratamiento_id: '813198b5-15c6-469f-a694-f1616c0bcd1d',
        tipo_tratamiento_codigo: 'quimioterapia',
        tipo_tratamiento_nombre: 'Quimioterapia',
      };
    else if (path.endsWith('/terminos/vigente')) value = definition;
    else if (init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body)));
      if (!revoked) required = false;
      value = current;
    } else
      value = {
        requiere_aceptacion: required,
        terminos_vigentes: definition,
        consentimiento_actual: current,
        historial_previo: [],
      };
    return {
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(value),
    } as unknown as Response;
  };
  const session = new HttpSessionAdapter({ config, vault, newId: () => operation, fetch: fake });
  await session.selectDemoPatient(DEMO_USERS[0].id);
  mockData.identitySession = session;
  return { session, bodies };
}
afterEach(() => {
  mockData.identitySession = null;
});
describe('Online consent in the actual screen and session adapter', () => {
  it('presents a synthetic definition and enables uploads only after C-16 plus fresh C-15', async () => {
    const { session, bodies } = await setup();
    await render(<OnlineConsentScreen />);
    expect(await screen.findByText('Términos de prueba online')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Aceptar términos online' }).props.accessibilityState
          .disabled,
      ).toBe(false),
    );
    expect(session.getSnapshot().uploadAllowed).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Aceptar términos online' }));
    expect(await screen.findByText('Aceptación confirmada por el servidor.')).toBeTruthy();
    expect(session.getSnapshot().uploadAllowed).toBe(true);
    expect(bodies).toEqual([
      { definicion_terminos_id: term, operacion_id: operation, codigo: 'TERMINOS_PLATAFORMA' },
    ]);
  });
  it('keeps a 200 revoked replay paused and never displays a successful acceptance', async () => {
    const { session } = await setup(true);
    await render(<OnlineConsentScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Aceptar términos online' }).props.accessibilityState
          .disabled,
      ).toBe(false),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Aceptar términos online' }));
    expect(await screen.findByText('La cuenta no tiene permiso para esta operación.')).toBeTruthy();
    expect(session.getSnapshot().uploadAllowed).toBe(false);
    expect(screen.queryByText('Aceptación confirmada por el servidor.')).toBeNull();
  });
  it('does not offer a local grant without a configured service', async () => {
    await render(<OnlineConsentScreen />);
    expect(
      await screen.findByText(
        'El servicio de términos no está configurado. Una aceptación local no habilita envíos.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aceptar términos online' })).toBeNull();
  });
});
