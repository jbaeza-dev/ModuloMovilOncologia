import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { CredentialVault } from './credential-vault';
import { sessionConfig } from './session-config';
import type { SessionConfig } from './session-config';
import { HttpSessionAdapter } from './http-session-adapter';
import { UnconfiguredSessionAdapter } from './unconfigured-session-adapter';
import { SessionFailure } from './http-session-types';
import { DeviceClient } from './device-client';

export function nativeVault(scope: string): CredentialVault {
  const namespace = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope).then(
    (hash) => 'quimiocare.p03.' + hash,
  );
  const options = async () => ({
    keychainService: await namespace,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  const key = (value: string) => {
    if (!/^[a-zA-Z0-9_.-]+$/.test(value)) throw new SessionFailure('invalid');
    return value;
  };
  return {
    read: async (k) => SecureStore.getItemAsync(key(k), await options()),
    write: async (k, v) => SecureStore.setItemAsync(key(k), v, await options()),
    remove: async (k) => SecureStore.deleteItemAsync(key(k), await options()),
  };
}
async function googleLogin(config: SessionConfig, signal: AbortSignal): Promise<unknown> {
  const redirect = config.redirectUri!;
  const request = new AuthSession.AuthRequest({
    clientId: 'quimiocare',
    redirectUri: redirect,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });
  await request.makeAuthUrlAsync({ authorizationEndpoint: config.authUrl + '/authorize' });
  if (signal.aborted || !request.codeVerifier || !request.codeChallenge)
    throw new SessionFailure('changed');
  const returnTo = new URL(redirect);
  returnTo.searchParams.set('qc_state', request.state);
  const url = new URL(config.authUrl + '/authorize');
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', returnTo.href);
  url.searchParams.set('code_challenge', request.codeChallenge);
  url.searchParams.set('code_challenge_method', 's256');
  const dismiss = () => WebBrowser.dismissAuthSession();
  signal.addEventListener('abort', dismiss, { once: true });
  try {
    const result = await WebBrowser.openAuthSessionAsync(url.href, redirect);
    if (signal.aborted) throw new SessionFailure('changed');
    if (result.type !== 'success') throw new SessionFailure('expired');
    const callback = new URL(result.url),
      expected = new URL(redirect);
    if (
      callback.protocol !== expected.protocol ||
      callback.host !== expected.host ||
      callback.pathname !== expected.pathname ||
      callback.searchParams.get('qc_state') !== request.state ||
      !callback.searchParams.get('code')
    )
      throw new SessionFailure('invalid');
    const timeout = new AbortController(),
      abort = () => timeout.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 12000);
    try {
      const r = await fetch(config.authUrl + '/token?grant_type=pkce', {
        method: 'POST',
        redirect: 'error',
        signal: timeout.signal,
        headers: { apikey: config.publicKey!, 'content-type': 'application/json' },
        body: JSON.stringify({
          auth_code: callback.searchParams.get('code'),
          code_verifier: request.codeVerifier,
        }),
      });
      if (r.status !== 200) throw new SessionFailure(r.status >= 500 ? 'unavailable' : 'expired');
      return (await r.json()) as unknown;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  } finally {
    signal.removeEventListener('abort', dismiss);
  }
}
export function createMobileSession() {
  const explicit = process.env.EXPO_PUBLIC_APP_ENV;
  const config = sessionConfig({
    APP_ENV:
      explicit ?? (process.env.EXPO_PUBLIC_DEMO_MODE === 'true' || __DEV__ ? 'demo' : 'production'),
    CLINICAL_URL: process.env.EXPO_PUBLIC_CLINICAL_URL,
    GATEWAY_URL: process.env.EXPO_PUBLIC_GATEWAY_URL,
    AUTH_URL: process.env.EXPO_PUBLIC_AUTH_URL,
    AUTH_ISSUER: process.env.EXPO_PUBLIC_AUTH_ISSUER,
    AUTH_AUDIENCE: process.env.EXPO_PUBLIC_AUTH_AUDIENCE,
    AUTH_PUBLIC_KEY: process.env.EXPO_PUBLIC_AUTH_PUBLIC_KEY,
    AUTH_REDIRECT_URI: process.env.EXPO_PUBLIC_AUTH_REDIRECT_URI,
  });
  if (!config) return new UnconfiguredSessionAdapter();
  const session = new HttpSessionAdapter({
    config,
    vault: nativeVault(config.scope),
    newId: Crypto.randomUUID,
    ...(config.mode === 'production'
      ? { googleLogin: (signal: AbortSignal) => googleLogin(config, signal) }
      : {}),
  });
  return session;
}
export function createDeviceClient(session: HttpSessionAdapter) {
  return new DeviceClient(session);
}
export async function registerNativePush(devices: DeviceClient) {
  const context = devices.captureContext();
  if (Platform.OS !== 'android') throw new SessionFailure('invalid');
  await Notifications.setNotificationChannelAsync('quimiocare', {
    name: 'QuimioCare',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      'El permiso de notificaciones está desactivado. Puedes seguir usando tus datos locales.',
    );
  devices.assertContext(context);
  const projectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID;
  if (!projectId)
    throw new Error('Falta configurar el proyecto de notificaciones de esta compilación.');
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  devices.assertContext(context);
  return devices.register(token.data, { version_so: String(Platform.Version) });
}
