import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { HttpAssistantAdapter } from '../services/assistant/http-assistant-adapter';
import { UnconfiguredAssistantAdapter } from '../services/assistant/unconfigured-assistant-adapter';
import { HttpSessionAdapter } from '../services/session/http-session-adapter';
import { createDeviceClient, createMobileSession } from '../services/session/native-session';
import { SessionRecovery } from '../services/session/session-recovery';
import type { SessionAdapter } from '../services/session/session-adapter';
import { PatientContextManager, type RouterAdapter } from './patient-context-manager';

/**
 * Crea la sesión, el cliente de dispositivos, el asistente y el administrador del contexto de
 * paciente, y mantiene la recuperación de sesión al día con el estado de la app y de la red.
 * Cada cambio del administrador vuelve a renderizar el proveedor.
 */
export function usePatientContext() {
  const routerAdapter = useMemo<RouterAdapter>(
    () => ({
      replace: (route: string) => router.replace(route as Href),
      push: (route: string) => router.push(route as Href),
    }),
    [],
  );

  const sessionAdapter = useMemo<SessionAdapter>(() => createMobileSession(), []);

  const identitySession = sessionAdapter instanceof HttpSessionAdapter ? sessionAdapter : null;
  const devices = useMemo(
    () => (identitySession ? createDeviceClient(identitySession) : null),
    [identitySession],
  );

  const assistantAdapter = useMemo(
    () =>
      identitySession
        ? new HttpAssistantAdapter(identitySession)
        : new UnconfiguredAssistantAdapter(),
    [identitySession],
  );

  const [, setVersion] = useState(0);

  const manager = useMemo(
    () =>
      new PatientContextManager({
        sessionAdapter,
        assistantAdapter,
        router: routerAdapter,
        newId: () => Crypto.randomUUID(),
        onStateChange: () => setVersion((v) => v + 1),
        cancelNotifications: async () => {
          if (typeof Notifications?.cancelAllScheduledNotificationsAsync === 'function') {
            await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
          }
        },
      }),
    [sessionAdapter, assistantAdapter, routerAdapter],
  );

  useEffect(() => {
    if (!identitySession) return;
    const recovery = new SessionRecovery(identitySession);
    recovery.setForeground(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', (state) => {
      recovery.setForeground(state === 'active');
    });
    let observedNetwork = false;
    const network = Network.addNetworkStateListener((state) => {
      observedNetwork = true;
      recovery.setOnline(state.isConnected === true && state.isInternetReachable !== false);
    });
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (observedNetwork) return;
        recovery.setOnline(state.isConnected === true && state.isInternetReachable !== false);
      })
      .catch(() => undefined);
    return () => {
      recovery.dispose();
      app.remove();
      network.remove();
    };
  }, [identitySession]);

  return { manager, routerAdapter, identitySession, devices };
}
