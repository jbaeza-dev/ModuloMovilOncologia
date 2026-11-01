import { describe, expect, it, vi } from 'vitest';
import { supabaseGoogleLogin, type GoogleLoginRuntime } from './supabase-google-login';
import { sessionConfig } from './session-config';

const env = {
  APP_ENV: 'universidad-demo',
  CLINICAL_URL: 'http://127.0.0.1:3102',
  GATEWAY_URL: 'http://127.0.0.1:3101',
  AUTH_URL: 'https://auth.example/auth/v1',
  AUTH_ISSUER: 'https://auth.example/auth/v1',
  AUTH_AUDIENCE: 'authenticated',
  AUTH_PUBLIC_KEY: 'public-test-key',
  AUTH_REDIRECT_URI: 'quimiocare://acceso/oauth',
};
const config = sessionConfig(env)!;
function harness(callback = 'quimiocare://acceso/oauth?qc_state=state&code=one-use-code') {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: 'token' }));
  const runtime: GoogleLoginRuntime = {
    createRequest: async () => ({
      state: 'state',
      verifier: 'private-verifier',
      challenge: 'challenge',
    }),
    open: vi.fn(async () => ({ type: 'success', url: callback })),
    dismiss: vi.fn(),
    fetch: fetcher,
  };
  return { runtime, fetcher, controller: new AbortController() };
}
describe('Supabase Google PKCE', () => {
  it('uses Google authorize and exchanges the returned code with its verifier', async () => {
    const h = harness();
    expect(await supabaseGoogleLogin(config, h.controller.signal, h.runtime)).toEqual({
      access_token: 'token',
    });
    const [url, redirect] = vi.mocked(h.runtime.open).mock.calls[0]!;
    const auth = new URL(url);
    expect(auth.origin).toBe('https://auth.example');
    expect(auth.searchParams.get('provider')).toBe('google');
    expect(auth.searchParams.get('code_challenge_method')).toBe('s256');
    expect(auth.searchParams.get('redirect_to')).toBe(redirect + '?qc_state=state');
    expect(url).not.toContain('private-verifier');
    expect(h.fetcher).toHaveBeenCalledWith(
      config.authUrl + '/token?grant_type=pkce',
      expect.objectContaining({
        headers: { apikey: 'public-test-key', 'content-type': 'application/json' },
        body: JSON.stringify({ auth_code: 'one-use-code', code_verifier: 'private-verifier' }),
      }),
    );
  });
  it.each([
    'quimiocare://acceso/oauth?qc_state=wrong&code=x',
    'other://acceso/oauth?qc_state=state&code=x',
    'quimiocare://otro/oauth?qc_state=state&code=x',
    'quimiocare://acceso/other?qc_state=state&code=x',
    'quimiocare://acceso/oauth?qc_state=state&code=x&code=y',
    'quimiocare://acceso/oauth?qc_state=state&code=x&error=access_denied',
    'quimiocare://acceso/oauth?qc_state=state#access_token=x',
  ])('rejects an unbound/error callback before exchanging credentials: %s', async (callback) => {
    const h = harness(callback);
    await expect(supabaseGoogleLogin(config, h.controller.signal, h.runtime)).rejects.toMatchObject(
      { kind: 'invalid' },
    );
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('does not exchange a cancelled browser session', async () => {
    const h = harness();
    h.runtime.open = async () => ({ type: 'cancel' });
    await expect(supabaseGoogleLogin(config, h.controller.signal, h.runtime)).rejects.toMatchObject(
      { kind: 'expired' },
    );
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('dismisses the browser and ignores a late return after logout', async () => {
    const h = harness();
    h.runtime.open = async () => {
      h.controller.abort();
      return { type: 'success', url: 'quimiocare://acceso/oauth?qc_state=state&code=x' };
    };
    await expect(supabaseGoogleLogin(config, h.controller.signal, h.runtime)).rejects.toMatchObject(
      { kind: 'changed' },
    );
    expect(h.runtime.dismiss).toHaveBeenCalledOnce();
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('treats a reused or expired code as an expired session', async () => {
    const h = harness();
    h.fetcher.mockResolvedValue(Response.json({}, { status: 400 }));
    await expect(supabaseGoogleLogin(config, h.controller.signal, h.runtime)).rejects.toMatchObject(
      { kind: 'expired' },
    );
  });
  it('allows loopback services only for university testing and requires HTTPS Auth', () => {
    expect(config).not.toBeNull();
    expect(sessionConfig({ ...env, APP_ENV: 'production' })).toBeNull();
    expect(sessionConfig({ ...env, AUTH_URL: 'http://localhost/auth/v1' })).toBeNull();
    expect(sessionConfig({ ...env, CLINICAL_URL: 'http://public.example' })).toBeNull();
    expect(sessionConfig({ ...env, AUTH_ISSUER: 'https://another.example/auth/v1' })).toBeNull();
  });
});
