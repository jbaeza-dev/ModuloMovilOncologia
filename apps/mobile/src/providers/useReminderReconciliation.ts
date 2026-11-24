import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { createPatientRepository } from '../data/local/repository';
import { reconcileActiveAgenda } from '../services/agenda/active-agenda';
import type { AgendaClient } from '../services/agenda/agenda-client';
import type { AgendaCoordinator } from '../services/agenda/agenda-coordinator';
import type {
  CoordinatorResult,
  NotificationCoordinator,
} from '../services/reminders/notification-coordinator';
import { resetForegroundNoticesCheck, setForegroundNoticesCheck } from './foreground-notices';
import type { PatientContextManager } from './patient-context-manager';
import { devWarn } from '../services/diagnostics/dev-warn';

export type ScopedCoordinatorState = {
  patientId: string;
  contextEpoch: number;
  inFlight: boolean;
  result: CoordinatorResult | null;
};

type Repository = ReturnType<typeof createPatientRepository>;

const emptyResult = (
  status: CoordinatorResult['status'],
  incidencias: string[] = [],
): CoordinatorResult => ({
  status,
  totalDeseadas: 0,
  programadasConfirmadas: 0,
  cubiertoHastaIso: null,
  truncadas: 0,
  reglasAfectadas: [],
  incidencias,
});

/**
 * Reconcilia los avisos programados en el teléfono con las reglas del paciente activo: al
 * seleccionar paciente, al volver a primer plano y al recuperar la red. Con agenda compartida
 * usa el coordinador nativo; si no, el coordinador local de recordatorios. El estado solo se
 * publica si el paciente y la época siguen siendo los mismos al terminar.
 */
export function useReminderReconciliation({
  manager,
  patientId,
  coordinator,
  repository,
  sharedAgenda,
  prepareAgenda,
  ensureAgendaRuntime,
  activeAgendaCoordinator,
  stopAgenda,
  bumpRemindersRevision,
}: {
  manager: PatientContextManager;
  patientId: string | null;
  coordinator: NotificationCoordinator | null;
  repository: Repository | null;
  sharedAgenda: AgendaClient | null;
  prepareAgenda: () => Promise<void>;
  ensureAgendaRuntime: () => Promise<void>;
  activeAgendaCoordinator: () => AgendaCoordinator | null;
  stopAgenda: () => Promise<void>;
  bumpRemindersRevision: () => void;
}) {
  const [scopedCoordinatorState, setScopedCoordinatorState] =
    useState<ScopedCoordinatorState | null>(null);
  const networkConnectedRef = useRef(false);

  const reconcileReminders = useCallback(
    async (targetPatientId?: string): Promise<CoordinatorResult | undefined> => {
      const currentId = targetPatientId ?? manager.getPatientId();
      const epoch = manager.getContextEpoch();
      if (!coordinator || !currentId) return undefined;
      const stillCurrent = () =>
        manager.getPatientId() === currentId && manager.getContextEpoch() === epoch;

      if (stillCurrent()) {
        setScopedCoordinatorState({
          patientId: currentId,
          contextEpoch: epoch,
          inFlight: true,
          result: null,
        });
      }

      let result: CoordinatorResult;
      if (sharedAgenda) {
        const assertAgendaContext = () => {
          sharedAgenda.assert();
          if (!stillCurrent()) throw new Error('El contexto de agenda cambió.');
        };
        assertAgendaContext();
        const prefs = await repository?.reminders?.getPreferences?.().catch(() => null);
        if (prefs && !prefs.enabled && prefs.updatedAt !== null) {
          await coordinator.cancelPatientSchedule(currentId).catch(() => undefined);
          await stopAgenda();
          result = emptyResult('desactivada');
        } else {
          await ensureAgendaRuntime();
          const reconcileCurrent = () =>
            reconcileActiveAgenda(activeAgendaCoordinator, assertAgendaContext);
          // Retire this owner's legacy jobs even before registering a new push association.
          const legacy = await coordinator.cancelPatientSchedule(currentId);
          if (!legacy.success || legacy.pendingCount) {
            result = {
              ...emptyResult('programacion_pendiente', [
                'Quedan avisos anteriores pendientes de cancelar en este teléfono.',
              ]),
              motivoPendiente: 'cancelacion_regla_previa',
            };
          } else {
            // Cancel locally completed occurrences before any potentially slow network request.
            await reconcileCurrent();
            try {
              await sharedAgenda.refresh();
            } catch {
              sharedAgenda.assert();
            }
            const coverage = await reconcileCurrent();
            result = coverage
              ? {
                  status: !coverage.permission
                    ? 'permiso_denegado'
                    : coverage.pendingCancellations
                      ? 'programacion_pendiente'
                      : 'programada',
                  totalDeseadas: coverage.wanted,
                  programadasConfirmadas: coverage.confirmed,
                  cubiertoHastaIso: coverage.until,
                  truncadas: coverage.truncated,
                  reglasAfectadas: [],
                  incidencias: coverage.pendingCancellations
                    ? ['Quedan cancelaciones nativas pendientes.']
                    : [],
                }
              : emptyResult('programacion_pendiente', [
                  'Activa las notificaciones de este dispositivo para programar su respaldo.',
                ]);
          }
        }
      } else result = await coordinator.reconcile(currentId, stillCurrent);

      if (stillCurrent()) {
        setScopedCoordinatorState({
          patientId: currentId,
          contextEpoch: epoch,
          inFlight: false,
          result,
        });
        bumpRemindersRevision();
      }

      return result;
    },
    [
      coordinator,
      manager,
      sharedAgenda,
      repository,
      ensureAgendaRuntime,
      activeAgendaCoordinator,
      stopAgenda,
      bumpRemindersRevision,
    ],
  );

  // Los avisos que llegan con la app abierta respetan la preferencia del paciente activo.
  useEffect(() => {
    setForegroundNoticesCheck(async () => {
      if (!repository) return false;
      const prefs = await repository.reminders.getPreferences().catch(() => null);
      return prefs ? prefs.enabled : true;
    });
    return () => {
      resetForegroundNoticesCheck();
    };
  }, [repository]);

  // Reconciliación al seleccionar paciente
  useEffect(() => {
    if (patientId && coordinator) {
      void reconcileReminders().catch(() => undefined);
    }
  }, [patientId, coordinator, reconcileReminders]);

  // Reconciliación y reintento de aperturas pendientes al volver a primer plano (AppState active)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && manager.getPatientId()) {
        void manager.processPendingNotificationIntent().catch((err) => {
          devWarn('Error al procesar notificación pendiente al volver a primer plano:', err);
        });
        if (coordinator) {
          void prepareAgenda()
            .then(() => reconcileReminders())
            .catch(() => undefined);
        }
      }
    });
    return () => {
      subscription.remove();
    };
  }, [coordinator, reconcileReminders, manager, prepareAgenda]);

  // Al recuperar la red se prepara la agenda y se reconcilia.
  useEffect(() => {
    const sub = Network.addNetworkStateListener((state) => {
      const next = state.isConnected === true && state.isInternetReachable !== false;
      const wasConnected = networkConnectedRef.current;
      networkConnectedRef.current = next;
      if (next && !wasConnected && manager.getPatientId())
        void prepareAgenda()
          .then(() => reconcileReminders())
          .catch(() => undefined);
    });
    return () => sub.remove();
  }, [prepareAgenda, reconcileReminders, manager]);

  const activeContextEpoch = manager.getContextEpoch();
  const validScopedCoordinatorState =
    scopedCoordinatorState &&
    scopedCoordinatorState.patientId === patientId &&
    scopedCoordinatorState.contextEpoch === activeContextEpoch
      ? scopedCoordinatorState
      : null;

  return { reconcileReminders, scopedCoordinatorState: validScopedCoordinatorState };
}
