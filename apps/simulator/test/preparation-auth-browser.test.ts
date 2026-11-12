import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto, createHash } from 'node:crypto';
import { readConfig } from '../src/config.js';

const scriptUrl = new URL('../src/docs/preparation-auth.js', import.meta.url);
const script = await readFile(scriptUrl, 'utf8');
// El nombre real del archivo permite que la cobertura V8 atribuya la ejecución en el sandbox.
const scriptFile = fileURLToPath(scriptUrl);
const root = '/quimiocare/docs/preparacion/';
const issuer = 'https://auth.example/auth/v1';
const state = 's'.repeat(43);
const verifier = 'v'.repeat(43);
function harness(query = '', authorized: boolean | number = true) {
  const nodes = Object.fromEntries(
    [
      'qc-login',
      'qc-logout',
      'qc-access-status',
      'qc-login-gate',
      'qc-swagger-shell',
      'qc-document-preparacion',
      'qc-document-contrato',
    ].map((id) => [
      id,
      {
        textContent: '',
        hidden: true,
        disabled: false,
        onclick: undefined as undefined | (() => Promise<void> | void),
      },
    ]),
  );
  const storage = new Map<string, string>();
  const key = 'qc-preparation-pkce:' + root;
  const order: string[] = [];
  const fetch = vi.fn().mockImplementation(async (url: string) => {
    const status = typeof authorized === 'number' ? authorized : authorized ? 200 : 403;
    order.push('fetch');
    return url.includes('/token?')
      ? {
          ok: true,
          json: async () => ({
            access_token: 'synthetic-access-token',
            refresh_token: 'never-store-this',
            expires_in: 3600,
          }),
        }
      : {
          ok: status === 200,
          status,
          json: async () => ({ autorizado: true }),
        };
  });
  const window = {
    initPreparationAuth: undefined as unknown as (ui: unknown, config: unknown) => Promise<void>,
    location: {
      origin: 'http://localhost:18018',
      href: 'http://localhost:18018' + root + (query ? 'oauth/callback' + query : ''),
      assign: vi.fn(),
    },
    history: { replaceState: vi.fn(() => order.push('strip-query')) },
    isSecureContext: true,
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
    addEventListener: vi.fn(),
  };
  const ui = {
    preauthorizeApiKey: vi.fn(),
    authActions: { logout: vi.fn() },
    specActions: { updateJsonSpec: vi.fn() },
  };
  const createUi = vi.fn().mockResolvedValue(ui);
  runInNewContext(
    script,
    {
      window,
      document: { getElementById: (id: string) => nodes[id] },
      sessionStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      },
      crypto: webcrypto,
      TextEncoder,
      Uint8Array,
      btoa,
      URL,
      fetch,
      AbortSignal,
      Date,
    },
    { filename: scriptFile },
  );
  const start = () =>
    window.initPreparationAuth(createUi, { root, issuer, publicKey: 'sb_publishable_test' });
  const pending = (createdAt = Date.now()) =>
    storage.set(key, JSON.stringify({ state, verifier, createdAt }));
  return { nodes, storage, ui, createUi, window, fetch, start, pending, order };
}
describe('Google access in the preparation browser page', () => {
  it.each([
    {
      status: 503,
      message: 'El servicio de acceso no está disponible temporalmente. Inténtalo más tarde.',
    },
    { status: 401, message: 'La sesión no es válida o venció. Vuelve a entrar con Google.' },
    {
      status: 403,
      message:
        'Tu cuenta Google no está autorizada como operador. Solicita su autorización local una sola vez.',
    },
  ])(
    'distinguishes access failure $status without exposing the contract or persisting a token',
    async ({ status, message }) => {
      const h = harness('?code=x&qc_state=' + state, status);
      h.pending();
      await h.start();
      expect(h.nodes['qc-access-status']!.textContent).toBe(message);
      expect(h.nodes['qc-login-gate']!.hidden).toBe(false);
      expect(h.nodes['qc-swagger-shell']!.hidden).toBe(true);
      expect(h.createUi).not.toHaveBeenCalled();
      expect(h.storage.size).toBe(0);
    },
  );
  it('shows only Google login without creating Swagger or fetching a contract', async () => {
    const h = harness();
    await h.start();
    expect(h.nodes['qc-login-gate']!.hidden).toBe(false);
    expect(h.nodes['qc-swagger-shell']!.hidden).toBe(true);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.createUi).not.toHaveBeenCalled();
  });
  it('opens Swagger only after operator approval and discards it on logout', async () => {
    const h = harness('?code=x&qc_state=' + state);
    h.pending();
    await h.start();
    expect(h.createUi).toHaveBeenCalledWith(
      'synthetic-access-token',
      'preparacion',
      expect.any(Function),
    );
    expect(h.nodes['qc-login-gate']!.hidden).toBe(true);
    expect(h.nodes['qc-swagger-shell']!.hidden).toBe(false);
    await h.nodes['qc-document-contrato']!.onclick!();
    expect(h.createUi).toHaveBeenLastCalledWith(
      'synthetic-access-token',
      'contrato',
      expect.any(Function),
    );
    expect(h.ui.preauthorizeApiKey).toHaveBeenLastCalledWith(
      'HTTPBearer',
      'synthetic-access-token',
    );
    const interceptor = h.createUi.mock.calls[0]![2];
    expect(
      interceptor({
        url: 'http://localhost:18018/admin/api/v1/preparacion/categorias',
        headers: {},
      }).headers.Authorization,
    ).toBe('Bearer synthetic-access-token');
    expect(
      interceptor({
        url: 'https://other.example/path',
        headers: { Authorization: 'old', authorization: 'old' },
      }).headers,
    ).toEqual({});
    await h.nodes['qc-logout']!.onclick!();
    expect(h.nodes['qc-swagger-shell']!.hidden).toBe(true);
    expect(h.nodes['qc-login-gate']!.hidden).toBe(false);
    expect(() =>
      interceptor({
        url: 'http://localhost:18018/admin/api/v1/preparacion/categorias',
        headers: {},
      }),
    ).toThrow('cerrada');
    expect(h.ui.specActions.updateJsonSpec).toHaveBeenCalledWith({});
  });
  it('returns to login if protected schema loading fails', async () => {
    const h = harness('?code=x&qc_state=' + state);
    h.pending();
    h.createUi.mockRejectedValue(new Error('Documentación no disponible'));
    await h.start();
    expect(h.nodes['qc-swagger-shell']!.hidden).toBe(true);
    expect(h.nodes['qc-login-gate']!.hidden).toBe(false);
    expect(h.ui.preauthorizeApiKey).not.toHaveBeenCalled();
    expect(h.nodes['qc-access-status']!.textContent).toBe('Documentación no disponible');
  });
  it('keeps the contract hidden if boot fails or expires while loading', async () => {
    const h = harness('?code=x&qc_state=' + state);
    h.pending();
    let finish!: (value: typeof h.ui) => void;
    h.createUi.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const started = h.start();
    await vi.waitFor(() => expect(h.createUi).toHaveBeenCalledTimes(1));
    h.window.setTimeout.mock.calls[0]![0]();
    finish(h.ui);
    await started;
    expect(h.nodes['qc-swagger-shell']!.hidden).toBe(true);
    expect(h.ui.preauthorizeApiKey).not.toHaveBeenCalled();
    expect(h.ui.authActions.logout).toHaveBeenCalled();
  });
  it('builds PKCE with random state and stores only the verifier transaction', async () => {
    const h = harness();
    await h.start();
    await h.nodes['qc-login']!.onclick!();
    const url = new URL(h.window.location.assign.mock.calls[0]![0]);
    const saved = JSON.parse([...h.storage.values()][0]!);
    expect(url.origin).toBe('https://auth.example');
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(saved.verifier).digest('base64url'),
    );
    expect(new URL(url.searchParams.get('redirect_to')!).searchParams.get('qc_state')).toBe(
      saved.state,
    );
    expect(h.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify([...h.storage.values()])).not.toContain('access_token');
  });
  it('strips the code before exchange, verifies operator and authorizes Swagger in memory', async () => {
    const h = harness('?code=one-time-code&qc_state=' + state);
    h.pending();
    await h.start();
    expect(h.order[0]).toBe('strip-query');
    expect(h.fetch.mock.calls[1]![0]).toBe('/quimiocare/admin/api/v1/preparacion/acceso');
    expect(h.ui.preauthorizeApiKey).toHaveBeenCalledWith(
      'OperadorBearer',
      'synthetic-access-token',
    );
    expect(h.storage.size).toBe(0);
    expect(h.nodes['qc-logout']!.hidden).toBe(false);
    const request = JSON.parse(h.fetch.mock.calls[0]![1].body);
    expect(request).toEqual({ auth_code: 'one-time-code', code_verifier: verifier });
    const expire = h.window.setTimeout.mock.calls[0]![0];
    expire();
    expect(h.nodes['qc-access-status']!.textContent).toContain('venció');
  });
  it.each([
    '?code=x&qc_state=wrong',
    '?code=x&code=y&qc_state=' + state,
    '?error=denied&qc_state=' + state,
    '#access_token=implicit',
  ])('rejects invalid callback %s without exchanging a code', async (query) => {
    const h = harness(query);
    h.pending();
    await h.start();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.ui.preauthorizeApiKey).not.toHaveBeenCalled();
    expect(h.storage.size).toBe(0);
  });
  it('rejects expired or replayed browser transactions', async () => {
    const h = harness('?code=x&qc_state=' + state);
    h.pending(Date.now() - 600001);
    await h.start();
    await h.start();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.ui.preauthorizeApiKey).not.toHaveBeenCalled();
  });
  it('does not authorize or enroll a Google account without local operator permission', async () => {
    const h = harness('?code=x&qc_state=' + state, false);
    h.pending();
    await h.start();
    expect(h.ui.preauthorizeApiKey).not.toHaveBeenCalled();
    expect(h.createUi).not.toHaveBeenCalled();
    expect(h.nodes['qc-access-status']!.textContent).toContain('no está autorizada');
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.storage.size).toBe(0);
  });
  it('signs out only this Swagger page without signing out the mobile account', async () => {
    const h = harness('?code=x&qc_state=' + state);
    h.pending();
    await h.start();
    await h.nodes['qc-logout']!.onclick!();
    expect(h.ui.authActions.logout).toHaveBeenCalledWith(['OperadorBearer', 'HTTPBearer']);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.storage.size).toBe(0);
  });
  it('never exposes a server secret as AUTH_PUBLIC_KEY', () => {
    const env = {
      APP_ENV: 'demo',
      DATABASE_URL: 'postgres://unused/test',
      DEMO_SIGNING_KEY: 'synthetic-signing-key-minimum-32-bytes',
      DEMO_CONTROL_KEY: 'synthetic-control-key-minimum-32-bytes',
      SIMULATOR_PUBLIC_BASE_URL: 'http://localhost:3102',
    };
    expect(() => readConfig({ ...env, AUTH_PUBLIC_KEY: 'sb_secret_not-for-browser' })).toThrow(
      'AUTH_PUBLIC_KEY',
    );
    const legacy =
      'header.' +
      Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') +
      '.signature';
    expect(() => readConfig({ ...env, AUTH_PUBLIC_KEY: legacy })).toThrow('AUTH_PUBLIC_KEY');
    expect(
      readConfig({ ...env, AUTH_PUBLIC_KEY: 'sb_publishable_public-only' }).authPublicKey,
    ).toBe('sb_publishable_public-only');
  });
});
