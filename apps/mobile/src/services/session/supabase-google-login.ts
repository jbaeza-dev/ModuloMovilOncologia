import type { SessionConfig } from './session-config';
import { SessionFailure } from './http-session-types';

export interface GoogleLoginRuntime {
  createRequest(): Promise<{ state: string; verifier: string; challenge: string }>;
  open(url: string, redirect: string): Promise<{ type: string; url?: string }>;
  dismiss(): void;
  fetch?: typeof fetch;
}

/** Supabase owns OAuth state; qc_state binds the app callback to this PKCE request. */
export async function supabaseGoogleLogin(
  config: SessionConfig,
  signal: AbortSignal,
  runtime: GoogleLoginRuntime,
): Promise<unknown> {
  if (signal.aborted) throw new SessionFailure('changed');
  const request = await runtime.createRequest();
  if (signal.aborted) throw new SessionFailure('changed');
  if (
    !request.state ||
    !request.verifier ||
    !request.challenge ||
    !config.redirectUri ||
    !config.publicKey
  )
    throw new SessionFailure('invalid');
  const redirect = config.redirectUri;
  const returnTo = new URL(redirect);
  returnTo.searchParams.set('qc_state', request.state);
  const url = new URL(config.authUrl + '/authorize');
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', returnTo.href);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 's256');
  const dismiss = () => runtime.dismiss();
  signal.addEventListener('abort', dismiss, { once: true });
  try {
    const result = await runtime.open(url.href, redirect);
    if (signal.aborted) throw new SessionFailure('changed');
    if (result.type !== 'success') throw new SessionFailure('expired');
    if (!result.url) throw new SessionFailure('invalid');
    const callback = new URL(result.url),
      expected = new URL(redirect);
    if (
      callback.protocol !== expected.protocol ||
      callback.host !== expected.host ||
      callback.pathname !== expected.pathname ||
      callback.hash ||
      callback.searchParams.getAll('qc_state').length !== 1 ||
      callback.searchParams.get('qc_state') !== request.state ||
      callback.searchParams.getAll('code').length !== 1 ||
      !callback.searchParams.get('code') ||
      callback.searchParams.has('error')
    )
      throw new SessionFailure('invalid');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(abort, 12000);
    try {
      const response = await (runtime.fetch ?? fetch)(config.authUrl + '/token?grant_type=pkce', {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { apikey: config.publicKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          auth_code: callback.searchParams.get('code'),
          code_verifier: request.verifier,
        }),
      });
      if (signal.aborted) throw new SessionFailure('changed');
      if (response.status !== 200)
        throw new SessionFailure(response.status >= 500 ? 'unavailable' : 'expired');
      return (await response.json()) as unknown;
    } catch (error) {
      if (signal.aborted) throw new SessionFailure('changed');
      if (error instanceof SessionFailure) throw error;
      throw new SessionFailure('unavailable');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  } finally {
    signal.removeEventListener('abort', dismiss);
  }
}
