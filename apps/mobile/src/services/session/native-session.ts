import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabaseGoogleLogin } from './supabase-google-login';

WebBrowser.maybeCompleteAuthSession();
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { CredentialVault } from './credential-vault';
import { sessionConfig } from './session-config';
import { HttpSessionAdapter } from './http-session-adapter';
import { UnconfiguredSessionAdapter } from './unconfigured-session-adapter';
import { SessionFailure } from './http-session-types';
import { DeviceClient } from './device-client';
import { shouldRequestNotificationPermission } from './notification-permission';

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
export function createMobileSession() {
  const explicit = process.env.EXPO_PUBLIC_APP_ENV;
  const config = sessionConfig({
    APP_ENV: explicit ?? 'production',
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
    googleLogin: (signal: AbortSignal) =>
      supabaseGoogleLogin(config, signal, {
        createRequest: async () => {
          const request = new AuthSession.AuthRequest({
            clientId: 'quimiocare',
            redirectUri: config.redirectUri!,
            responseType: AuthSession.ResponseType.Code,
            usePKCE: true,
          });
          await request.makeAuthUrlAsync({
            authorizationEndpoint: config.authUrl + '/authorize',
          });
          return {
            state: request.state,
            verifier: request.codeVerifier!,
            challenge: request.codeChallenge!,
          };
        },
        open: (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect),
        dismiss: () => WebBrowser.dismissAuthSession(),
      }),
  });
  return session;
}
const INSTALLATION_KEY = 'quimiocare.expo.installation_id';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getOrCreateInstallationId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(INSTALLATION_KEY);
    if (existing && UUID_REGEX.test(existing)) {
      return existing;
    }
  } catch {
    // Si la lectura en almacenamiento seguro falla, continuar
  }
  const fresh = Crypto.randomUUID();
  try {
    await SecureStore.setItemAsync(INSTALLATION_KEY, fresh);
  } catch {
    // Si la persistencia falla, retornar el identificador válido en memoria
  }
  return fresh;
}

export function createDeviceClient(session: HttpSessionAdapter) {
  return new DeviceClient(session);
}
// El registro automático pide el permiso como máximo una vez por apertura de la app.
let autoPermissionRequested = false;

/**
 * Registra este teléfono para recibir push. Si falta el permiso, el registro automático lo pide una
 * sola vez por apertura de la app; con `userInitiated` (un botón) se pide siempre que Android lo
 * permita. Las demás llamadas automáticas solo consultan el permiso.
 */
export async function registerNativePush(
  devices: DeviceClient,
  { userInitiated = false }: { userInitiated?: boolean } = {},
) {
  const context = devices.captureContext();
  if (Platform.OS !== 'android') throw new SessionFailure('invalid');
  await Notifications.setNotificationChannelAsync('quimiocare', {
    name: 'QuimioCare',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  const current = await Notifications.getPermissionsAsync();
  const ask = shouldRequestNotificationPermission(current, userInitiated, autoPermissionRequested);
  // Se marca antes de esperar: otro registro automático simultáneo ya no vuelve a pedirlo.
  if (ask && !userInitiated) autoPermissionRequested = true;
  const permission = ask ? await Notifications.requestPermissionsAsync() : current;
  if (!permission.granted)
    throw new Error(
      'El permiso de notificaciones está desactivado. Puedes seguir usando tus datos locales.',
    );
  devices.assertContext(context);
  const projectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID;
  if (!projectId)
    throw new Error('Falta configurar el proyecto de notificaciones de esta compilación.');
  const deviceId = await getOrCreateInstallationId();
  const token = await Notifications.getExpoPushTokenAsync({
    projectId,
    deviceId,
    applicationId: 'cl.ubiobio.quimiocare',
  });
  devices.assertContext(context);
  return devices.register(token.data, { version_so: String(Platform.Version) });
}
