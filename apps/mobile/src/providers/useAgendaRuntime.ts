import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClinicalStore } from '../data/sync/native-runtime';
import { AgendaClient } from '../services/agenda/agenda-client';
import type { AgendaCoordinator } from '../services/agenda/agenda-coordinator';
import { activateNativeAgenda } from '../services/agenda/native-agenda';
import type { DeviceClient } from '../services/session/device-client';
import type { HttpSessionAdapter } from '../services/session/http-session-adapter';
import { registerNativePush } from '../services/session/native-session';
import type { PatientContextManager } from './patient-context-manager';

type AgendaRuntime = Awaited<ReturnType<typeof activateNativeAgenda>>;

async function cancelAllScheduled() {
  if (typeof Notifications?.cancelAllScheduledNotificationsAsync === 'function') {
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
  }
}

/**
 * Activa la agenda compartida del paciente activo: respeta la preferencia de avisos, registra el
 * push del dispositivo y guarda el coordinador nativo. Una sola preparación a la vez por sesión y
 * almacén; si el contexto cambió mientras tanto, el resultado se descarta.
 */
export function useAgendaRuntime({
  identitySession,
  clinicalStore,
  manager,
  devices,
}: {
  identitySession: HttpSessionAdapter | null;
  clinicalStore: ClinicalStore | null;
  manager: PatientContextManager;
  devices: DeviceClient | null;
}) {
  const sharedAgenda = useMemo(
    () =>
      identitySession && clinicalStore
        ? new AgendaClient(
            identitySession,
            clinicalStore.connection,
            clinicalStore.scope.environment,
          )
        : null,
    [identitySession, clinicalStore],
  );
  const [agendaCoordinator, setAgendaCoordinator] = useState<AgendaCoordinator | null>(null);
  const [agendaBackgroundReady, setAgendaBackgroundReady] = useState(false);
  const agendaRuntime = useRef<AgendaRuntime>(null);
  const agendaPreparation = useRef<{
    session: HttpSessionAdapter;
    store: ClinicalStore;
    promise: Promise<void>;
  } | null>(null);

  // Suelta la agenda activa y cancela todos los avisos programados en el teléfono.
  const releaseRuntime = useCallback(async (resetPreparation: boolean) => {
    const prev = agendaRuntime.current;
    agendaRuntime.current = null;
    if (resetPreparation) agendaPreparation.current = null;
    setAgendaCoordinator(null);
    setAgendaBackgroundReady(false);
    await prev?.close?.().catch(() => undefined);
    prev?.dispose?.();
    await cancelAllScheduled();
  }, []);

  const prepareAgenda = useCallback(() => {
    if (!identitySession || !clinicalStore) return Promise.resolve();
    const current = agendaPreparation.current;
    if (current?.session === identitySession && current.store === clinicalStore)
      return current.promise;
    const epoch = manager.getContextEpoch();
    const promise = manager.trackOperation(async () => {
      const runtimePromise = activateNativeAgenda(identitySession, clinicalStore);
      const prefRow = await clinicalStore.connection
        .first<{
          habilitado: number;
          actualizado_el: string | null;
        }>('SELECT habilitado, actualizado_el FROM preferencia_avisos WHERE paciente_id = ?', [
          clinicalStore.scope.localPatientId,
        ])
        .catch(() => null);
      let noticesEnabled = prefRow ? prefRow.habilitado === 1 : true;
      if (!prefRow) {
        await clinicalStore.connection
          .run(
            `INSERT INTO preferencia_avisos (paciente_id, habilitado, actualizado_el)
             VALUES (?, 1, ?)
             ON CONFLICT(paciente_id) DO NOTHING`,
            [clinicalStore.scope.localPatientId, new Date().toISOString()],
          )
          .catch(() => undefined);
        noticesEnabled = true;
      }
      if (!noticesEnabled) {
        const unusedRuntime = await runtimePromise.catch(() => null);
        await unusedRuntime?.close?.().catch(() => undefined);
        unusedRuntime?.dispose?.();
        await releaseRuntime(false);
        return;
      }
      let runtime = await runtimePromise;
      if (devices) {
        if (runtime) {
          // La asociación ya fue aceptada: se refresca el token push sin demorar la agenda.
          void registerNativePush(devices).catch(() => undefined);
        } else {
          // Sin asociación aceptada no hay coordinador. Se espera el registro (que también pide el
          // permiso) y se vuelve a activar; si no, la agenda queda vacía hasta otra actualización.
          const registered = await registerNativePush(devices).then(
            () => true,
            () => false,
          );
          if (registered) runtime = await activateNativeAgenda(identitySession, clinicalStore);
        }
      }
      if (
        clinicalStore.closed ||
        identitySession.getCurrentUser()?.id !== clinicalStore.scope.owner ||
        manager.getContextEpoch() !== epoch ||
        manager.getPatientId() !== clinicalStore.scope.localPatientId
      ) {
        runtime?.dispose();
        return;
      }
      const previous = agendaRuntime.current;
      agendaRuntime.current = runtime;
      if (previous !== runtime) previous?.dispose();
      setAgendaCoordinator(runtime?.coordinator ?? null);
      setAgendaBackgroundReady(runtime?.taskRegistered ?? false);
    });
    const preparation = { session: identitySession, store: clinicalStore, promise };
    preparation.promise = promise.finally(() => {
      if (agendaPreparation.current === preparation) agendaPreparation.current = null;
    });
    agendaPreparation.current = preparation;
    return preparation.promise;
  }, [identitySession, clinicalStore, manager, devices, releaseRuntime]);

  useEffect(() => {
    let active = true;
    void prepareAgenda().catch(() => {
      if (active) setAgendaBackgroundReady(false);
    });
    return () => {
      active = false;
      const outgoing = agendaRuntime.current;
      agendaRuntime.current = null;
      void Promise.resolve(manager.getActiveTeardownPromise()).then(() => outgoing?.dispose());
    };
  }, [prepareAgenda, manager]);

  /** Prepara la agenda de nuevo si no hay una activa (por ejemplo, tras reactivar los avisos). */
  const ensureAgendaRuntime = useCallback(async () => {
    if (agendaRuntime.current) return;
    agendaPreparation.current = null;
    await prepareAgenda().catch(() => undefined);
  }, [prepareAgenda]);

  /** Coordinador de la agenda activa en este momento (no el del último render). */
  const activeAgendaCoordinator = useCallback(() => agendaRuntime.current?.coordinator ?? null, []);

  /** Detiene la agenda cuando el paciente desactiva los avisos. */
  const stopAgenda = useCallback(() => releaseRuntime(true), [releaseRuntime]);

  return {
    sharedAgenda,
    agendaCoordinator,
    agendaBackgroundReady,
    prepareAgenda,
    ensureAgendaRuntime,
    activeAgendaCoordinator,
    stopAgenda,
  };
}
