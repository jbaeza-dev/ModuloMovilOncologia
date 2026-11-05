import { SessionRecovery } from '../services/session/session-recovery';
import { AppLoadingScreen } from '../components/AppLoadingScreen';
import { AutomaticEducationDownloads } from '../features/education/AutomaticEducationDownloads';
import type { ClinicalStore } from '../data/sync/native-runtime';
import { openClinicalStore } from '../data/sync/native-runtime';
import {
  QueryRevisionContext,
  ClinicalRevisionContext,
  EducationContentRevisionContext,
  EducationStatusRevisionContext,
  FormsRevisionContext,
  RemindersRevisionContext,
} from './QueryRevision';
import * as Crypto from 'expo-crypto';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { router, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Network from 'expo-network';

import { Screen } from '../components/Screen';
import { BodyText, VisualButton } from '../components/Visual';
import { ExpoFileStorageAdapter } from '../data/local/files/file-storage-adapter';
import { createPatientRepository } from '../data/local/repository';
import type { SqlConnection } from '../data/local/core/sql';
import { cleanupRetiredEducationalCopies } from '../data/local/education/retired-copy-cleanup';
import { importLegacyDrafts } from '../features/medical-forms/form-legacy-import';
import { isDemoMode } from '../utils/environment';
import { isValidNotificationPayload } from '../data/local/reminders/reminder-types';
import type { LocalNotificationAdapter } from '../services/notifications/notification-adapter';
import { ExpoNotificationAdapter } from '../services/notifications/expo-notification-adapter';
import {
  NotificationCoordinator,
  type CoordinatorResult,
} from '../services/reminders/notification-coordinator';
import type { AssistantController } from '../services/assistant/assistant-controller';
import { HttpAssistantAdapter } from '../services/assistant/http-assistant-adapter';
import { UnconfiguredAssistantAdapter } from '../services/assistant/unconfigured-assistant-adapter';

import { DEMO_USERS } from '../services/session/demo-session-adapter';
import { createMobileSession, createDeviceClient } from '../services/session/native-session';
import { HttpSessionAdapter } from '../services/session/http-session-adapter';
import { AgendaClient } from '../services/agenda/agenda-client';
import { activateNativeAgenda, handleAgendaNotification } from '../services/agenda/native-agenda';
import { notificationPayload, localAgendaData } from '../services/agenda/agenda-coordinator';
import type { AgendaCoordinator } from '../services/agenda/agenda-coordinator';
import { reconcileActiveAgenda } from '../services/agenda/active-agenda';
import type { DeviceClient } from '../services/session/device-client';
import type { SessionAdapter } from '../services/session/session-adapter';
import {
  PatientContextManager,
  type CloseReason,
  type TeardownResult,
  type RouterAdapter,
  type NotificationOpenResult,
} from './patient-context-manager';

export type { CloseReason, TeardownResult, NotificationOpenResult };

export type ScopedCoordinatorState = {
  patientId: string;
  contextEpoch: number;
  inFlight: boolean;
  result: CoordinatorResult | null;
};

try {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => ({
      shouldShowBanner: !notificationPayload(notification.request.content.data),
      shouldShowList: !notificationPayload(notification.request.content.data),
      shouldPlaySound: !notificationPayload(notification.request.content.data),
      shouldSetBadge: false,
    }),
  });
} catch {
  // Entornos de prueba o sin soporte nativo
}

export const DEMO_PATIENTS = [
  { id: DEMO_USERS[0].id, label: DEMO_USERS[0].name },
  { id: DEMO_USERS[1].id, label: DEMO_USERS[1].name },
] as const;

export type PreparationStatus = 'idle' | 'importing' | 'ready' | 'error';
export type FormImportWarning = {
  errors: number;
  pendingCleanups: number;
};

type Repository = ReturnType<typeof createPatientRepository>;
type DataContextValue = {
  database: SqlConnection | null;
  clinicalStore?: ClinicalStore | null;
  patientId: string | null;
  repository: Repository | null;
  coordinator: NotificationCoordinator | null;
  notificationAdapter: LocalNotificationAdapter;
  remindersRevision: number;
  scopedCoordinatorState: ScopedCoordinatorState | null;
  bumpRemindersRevision: () => void;
  saving: boolean;
  isClosing: boolean;
  formStorageReady: boolean;
  formImportStatus: PreparationStatus;
  formImportError: string | null;
  formImportWarning: FormImportWarning | null;
  retryFormImport: () => Promise<void>;
  reconcileReminders: (targetPatientId?: string) => Promise<CoordinatorResult | undefined>;
  retryPendingNotification: () => Promise<NotificationOpenResult>;
  runSave: <T>(work: () => Promise<T>) => Promise<T>;
  trackOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  closeActiveContext: (reason?: CloseReason) => Promise<TeardownResult>;
  selectPatient: (newPatientId: string) => Promise<void>;
  changePatient: () => void;
  activeTeardownPromise: Promise<TeardownResult> | null;
  assistantController?: AssistantController | null;
  sessionAdapter: SessionAdapter;
  manager: PatientContextManager;
  identitySession: HttpSessionAdapter | null;
  devices: DeviceClient | null;
  sharedAgenda?: AgendaClient | null;
  agendaCoordinator?: AgendaCoordinator | null;
  agendaBackgroundReady?: boolean;
  prepareAgenda?: () => Promise<void>;
};

const DataContext = createContext<DataContextValue | null>(null);

export function LocalDataProvider({ children }: { children: ReactNode }) {
  const [storage, setStorage] = useState<{ store: ClinicalStore; epoch: number } | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [queryRevision] = useState(0);
  const [clinicalRevision, setClinicalRevision] = useState(0);
  const [educationContentRevision, setEducationContentRevision] = useState(0);
  const [educationStatusRevision, setEducationStatusRevision] = useState(0);
  const [formsRevision, setFormsRevision] = useState(0);
  const openJobs = useRef<Promise<void>>(Promise.resolve());
  const restoreStarted = useRef(false);
  const networkConnectedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [formImportStatus, setFormImportStatus] = useState<PreparationStatus>('idle');
  const [formImportError, setFormImportError] = useState<string | null>(null);
  const [formImportWarning, setFormImportWarning] = useState<FormImportWarning | null>(null);
  const [importAttempt, setImportAttempt] = useState(0);
  const [remindersRevision, setRemindersRevision] = useState(0);
  const [scopedCoordinatorState, setScopedCoordinatorState] =
    useState<ScopedCoordinatorState | null>(null);

  const bumpRemindersRevision = useCallback(() => {
    setRemindersRevision((r) => r + 1);
  }, []);

  const routerAdapter = useMemo<RouterAdapter>(
    () => ({
      replace: (route: string) => router.replace(route as Href),
      push: (route: string) => router.push(route as Href),
    }),
    [],
  );

  const sessionAdapter = useMemo<SessionAdapter>(() => {
    return createMobileSession();
  }, []);

  const identitySession = sessionAdapter instanceof HttpSessionAdapter ? sessionAdapter : null;
  const devices = useMemo(
    () => (identitySession ? createDeviceClient(identitySession) : null),
    [identitySession],
  );

  const assistantAdapter = useMemo(() => {
    return identitySession
      ? new HttpAssistantAdapter(identitySession)
      : new UnconfiguredAssistantAdapter();
  }, [identitySession]);

  const [, setVersion] = useState(0);

  const manager = useMemo(() => {
    return new PatientContextManager({
      sessionAdapter,
      assistantAdapter,
      router: routerAdapter,
      newId: () => Crypto.randomUUID(),
      onStateChange: () => setVersion((v) => v + 1),
    });
  }, [sessionAdapter, assistantAdapter, routerAdapter]);

  useEffect(() => {
    if (!identitySession) return;
    const localTransport =
      identitySession.config.mode === 'demo' &&
      ['localhost', '127.0.0.1'].includes(new URL(identitySession.config.clinicalUrl).hostname);
    const recovery = new SessionRecovery(identitySession, localTransport);
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

  const patientId = manager.getPatientId();
  const contextEpoch = manager.getContextEpoch();
  const isClosing = manager.getIsClosing();
  const clinicalStore =
    storage &&
    storage.epoch === contextEpoch &&
    !storage.store.closed &&
    storage.store.scope.localPatientId === patientId &&
    storage.store.scope.owner === identitySession?.getCurrentUser()?.id
      ? storage.store
      : null;
  const database = clinicalStore?.connection ?? null;
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
  const agendaRuntime = useRef<Awaited<ReturnType<typeof activateNativeAgenda>>>(null);
  const agendaPreparation = useRef<{
    session: HttpSessionAdapter;
    store: ClinicalStore;
    promise: Promise<void>;
  } | null>(null);
  const prepareAgenda = useCallback(() => {
    if (!identitySession || !clinicalStore) return Promise.resolve();
    const current = agendaPreparation.current;
    if (current?.session === identitySession && current.store === clinicalStore)
      return current.promise;
    const epoch = manager.getContextEpoch();
    const promise = manager.trackOperation(async () => {
      const runtime = await activateNativeAgenda(identitySession, clinicalStore);
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
  }, [identitySession, clinicalStore, manager]);
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
  const labOnly =
    process.env.EXPO_PUBLIC_P04_LAB_ONLY === 'true' &&
    process.env.EXPO_PUBLIC_P04_PROBE_ENABLED === 'true' &&
    isDemoMode();
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    if (labOnly) {
      setSessionRestored(true);
      return;
    }
    void manager
      .restoreSession()
      .catch(() => undefined)
      .finally(() => setSessionRestored(true));
  }, [manager, labOnly]);

  useEffect(() => {
    manager.setDatabase(database);
  }, [manager, database]);

  useEffect(() => {
    manager.setRouter(routerAdapter);
  }, [manager, routerAdapter]);

  const retryFormImport = useCallback(async () => {
    setImportAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    if (!sessionRestored || !patientId || !identitySession || labOnly) return;
    let active = true,
      current: ClinicalStore | null = null,
      unwatch: (() => void) | null = null;
    const previous = openJobs.current;
    const pending = previous
      .catch(() => undefined)
      .then(async () => {
        if (!active) return;
        setError(null);
        try {
          current = await openClinicalStore(identitySession, patientId);
          if (!active) {
            await current.close();
            return;
          }
          const store = current;
          const unwatchClinical = store.database.onChange(
            {
              onChange: () => {
                if (active) {
                  setClinicalRevision((n) => n + 1);
                }
              },
            },
            {
              tables: ['signos_vitales', 'qc_clinical_command', 'qc_gateway_outbox'],
              throttleMs: 150,
            },
          );
          const unwatchEducationContent = store.database.onChange(
            {
              onChange: () => {
                if (active) {
                  setEducationContentRevision((n) => n + 1);
                }
              },
            },
            {
              tables: ['qc_storage_control'],
              throttleMs: 150,
            },
          );
          const unwatchEducationStatus = store.database.onChange(
            {
              onChange: () => {
                if (active) {
                  setEducationStatusRevision((n) => n + 1);
                }
              },
            },
            {
              tables: ['descarga', 'interaccion_educativa_local', 'qc_catalog_status'],
              throttleMs: 150,
            },
          );
          const unwatchForms = store.database.onChange(
            {
              onChange: () => {
                if (active) {
                  setFormsRevision((n) => n + 1);
                }
              },
            },
            {
              tables: ['qc_definition_snapshot', 'respuesta_formulario'],
              throttleMs: 150,
            },
          );
          unwatch = () => {
            unwatchClinical();
            unwatchEducationContent();
            unwatchEducationStatus();
            unwatchForms();
          };
          setStorage({ store, epoch: contextEpoch });
        } catch (failure) {
          if (active)
            setError(
              failure instanceof Error
                ? failure.message
                : 'No se pudo abrir el almacenamiento cifrado.',
            );
        }
      });
    openJobs.current = pending;
    return () => {
      active = false;
      unwatch?.();
      openJobs.current = pending.then(async () => {
        if (current) {
          await manager.getActiveTeardownPromise();
          await current.close();
        }
      });
    };
  }, [sessionRestored, patientId, identitySession, labOnly, attempt, contextEpoch]);

  useEffect(() => {
    if (!database || !patientId) {
      setFormImportStatus('idle');
      setFormImportError(null);
      setFormImportWarning(null);
      return;
    }
    let active = true;
    setFormImportStatus('importing');
    setFormImportError(null);
    const adapter = new ExpoFileStorageAdapter();
    manager
      .trackOperation(() => cleanupRetiredEducationalCopies(database, patientId, { adapter }))
      .catch((err) => {
        console.warn('Fallo en limpieza de copias educativas retiradas:', err);
      });

    manager
      .trackOperation(() =>
        importLegacyDrafts(patientId, database, adapter, undefined, Crypto.randomUUID),
      )
      .then((counts) => {
        if (active) {
          setFormImportStatus('ready');
          setFormImportError(null);
          if (counts && (counts.errors > 0 || counts.pendingCleanups > 0)) {
            setFormImportWarning({
              errors: counts.errors,
              pendingCleanups: counts.pendingCleanups,
            });
          } else {
            setFormImportWarning(null);
          }
        }
      })
      .catch((err) => {
        console.warn('Fallo en importación legacy:', err);
        if (active) {
          setFormImportStatus('error');
          setFormImportWarning(null);
          setFormImportError(
            err instanceof Error ? err.message : 'Error al procesar almacenamiento de formularios',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [database, patientId, importAttempt, manager]);

  const formStorageReady = formImportStatus === 'ready';

  const repository = useMemo(
    () =>
      database && patientId
        ? createPatientRepository(
            database,
            patientId,
            Crypto.randomUUID,
            undefined,
            clinicalStore?.captureHook,
          )
        : null,
    [database, patientId, clinicalStore],
  );

  const notificationAdapter = useMemo(() => new ExpoNotificationAdapter(), []);
  const coordinator = useMemo(
    () =>
      database
        ? new NotificationCoordinator(database, notificationAdapter, undefined, undefined, () =>
            manager.getPatientId(),
          )
        : null,
    [database, notificationAdapter, manager],
  );

  useEffect(() => {
    manager.setCoordinator(coordinator);
  }, [manager, coordinator]);

  const trackOperation = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => manager.trackOperation(operation),
    [manager],
  );

  const closeActiveContext = useCallback(
    (reason?: CloseReason): Promise<TeardownResult> => manager.closeActiveContext(reason),
    [manager],
  );

  const selectPatient = useCallback(
    (newPatientId: string): Promise<void> => manager.selectPatient(newPatientId),
    [manager],
  );

  const changePatient = useCallback(() => {
    manager.changePatient();
  }, [manager]);

  // Procesar intención de navegación pendiente cuando el paciente coincida
  useEffect(() => {
    const pending = manager.getPendingNotificationIntent();
    if (patientId && pending && pending.payload.pacienteId === patientId) {
      void manager.processPendingNotificationIntent();
    }
  }, [patientId, manager]);

  const reconcileReminders = useCallback(
    async (targetPatientId?: string): Promise<CoordinatorResult | undefined> => {
      const currentId = targetPatientId ?? manager.getPatientId();
      const epoch = manager.getContextEpoch();
      if (!coordinator || !currentId) return undefined;

      if (manager.getPatientId() === currentId && manager.getContextEpoch() === epoch) {
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
          if (manager.getPatientId() !== currentId || manager.getContextEpoch() !== epoch)
            throw new Error('El contexto de agenda cambió.');
        };
        assertAgendaContext();
        const reconcileCurrent = () =>
          reconcileActiveAgenda(
            () => agendaRuntime.current?.coordinator ?? null,
            assertAgendaContext,
          );
        // Retire this owner's legacy jobs even before registering a new push association.
        const legacy = await coordinator.cancelPatientSchedule(currentId);
        if (!legacy.success || legacy.pendingCount) {
          result = {
            status: 'programacion_pendiente',
            motivoPendiente: 'cancelacion_regla_previa',
            totalDeseadas: 0,
            programadasConfirmadas: 0,
            cubiertoHastaIso: null,
            truncadas: 0,
            reglasAfectadas: [],
            incidencias: ['Quedan avisos anteriores pendientes de cancelar en este teléfono.'],
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
            : {
                status: 'programacion_pendiente',
                totalDeseadas: 0,
                programadasConfirmadas: 0,
                cubiertoHastaIso: null,
                truncadas: 0,
                reglasAfectadas: [],
                incidencias: [
                  'Activa las notificaciones de este dispositivo para programar su respaldo.',
                ],
              };
        }
      } else
        result = await coordinator.reconcile(
          currentId,
          () => manager.getPatientId() === currentId && manager.getContextEpoch() === epoch,
        );

      if (manager.getPatientId() === currentId && manager.getContextEpoch() === epoch) {
        setScopedCoordinatorState({
          patientId: currentId,
          contextEpoch: epoch,
          inFlight: false,
          result,
        });
        setRemindersRevision((r) => r + 1);
      }

      return result;
    },
    [coordinator, manager, sharedAgenda],
  );

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
          console.warn('Error al procesar notificación pendiente al volver a primer plano:', err);
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

  // Capture intents before the account database opens; the manager validates owner before navigation.
  useEffect(() => {
    // Procesar respuesta previa de arranque (cold start)
    try {
      const last = Notifications.getLastNotificationResponse();
      if (last) {
        Notifications.clearLastNotificationResponse();
        const data = last.notification.request.content.data;
        const identifier = last.notification.request.identifier;
        if (localAgendaData(data)) {
          void handleAgendaNotification(data, true)
            .then((destination) => {
              if (typeof destination === 'string' && destination.startsWith('/'))
                router.push(destination as Href);
            })
            .catch(() => undefined);
        }
        if (isValidNotificationPayload(data)) {
          const dedupeKey = `${data.notificacionId}:${identifier || 'cold'}`;
          void manager.handleNotificationOpen(data, dedupeKey).catch((err) => {
            console.warn('Error en handleNotificationOpen cold start:', err);
          });
        }
      }
    } catch {
      // Ignorar en plataformas o entornos sin soporte
    }

    let responseSub: { remove: () => void } | null = null;
    let receivedSub: { remove: () => void } | null = null;

    try {
      responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        const identifier = response.notification.request.identifier;
        if (localAgendaData(data)) {
          void handleAgendaNotification(data, true)
            .then((destination) => {
              if (typeof destination === 'string' && destination.startsWith('/'))
                router.push(destination as Href);
            })
            .catch(() => undefined);
        }
        if (isValidNotificationPayload(data)) {
          const dedupeKey = `${data.notificacionId}:${identifier || 'listener'}`;
          void manager.handleNotificationOpen(data, dedupeKey).catch((err) => {
            console.warn('Error en handleNotificationOpen listener:', err);
          });
        }
      });

      receivedSub = Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data;
        if (notificationPayload(data) || localAgendaData(data)) {
          void handleAgendaNotification(data).catch(() => undefined);
        }
        if (isValidNotificationPayload(data)) {
          const currentId = manager.getPatientId();
          const currentEpoch = manager.getContextEpoch();
          if (currentId && data.pacienteId === currentId && repository) {
            void repository.reminders
              .recordNotificationObserved(data.notificacionId)
              .then(() => {
                if (
                  manager.getPatientId() === currentId &&
                  manager.getContextEpoch() === currentEpoch
                ) {
                  setRemindersRevision((r) => r + 1);
                }
              })
              .catch(() => undefined);
          }
        }
      });
    } catch {
      // Ignorar si no está disponible en este entorno
    }

    return () => {
      responseSub?.remove();
      receivedSub?.remove();
    };
  }, [database, repository, manager, agendaCoordinator]);

  useEffect(() => {
    if (!database || !patientId) return;
    const store = storage?.store;
    if (!store || store.closed) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (store.closed) return;
      if (state === 'active') {
        if (typeof store.resume === 'function') {
          void store.resume(false).catch((err) => {
            console.warn('Error al reanudar sincronización al volver a primer plano:', err);
          });
        }
      } else if (state === 'background' || state === 'inactive') {
        if (typeof store.disconnect === 'function') {
          void store.disconnect().catch((err) => {
            console.warn('Error al suspender sincronización en segundo plano:', err);
          });
        }
      }
    });
    return () => {
      sub.remove();
    };
  }, [database, patientId, storage]);

  useEffect(() => {
    if (!sharedAgenda || !agendaCoordinator) return;
    void reconcileReminders().catch(() => undefined);
  }, [sharedAgenda, agendaCoordinator, reconcileReminders]);

  const runSave = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      return manager.trackOperation(async () => {
        if (!manager.getPatientId() || savingRef.current) {
          throw new Error('Selecciona un paciente de prueba.');
        }
        savingRef.current = true;
        setSaving(true);
        try {
          const res = await work();
          if (sharedAgenda && agendaCoordinator) {
            void reconcileReminders().catch(() => undefined);
          }
          return res;
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      });
    },
    [manager, sharedAgenda, agendaCoordinator, reconcileReminders],
  );

  const retryPendingNotification = useCallback(async (): Promise<NotificationOpenResult> => {
    return manager.processPendingNotificationIntent();
  }, [manager]);

  const activeContextEpoch = manager.getContextEpoch();
  const validScopedCoordinatorState =
    scopedCoordinatorState &&
    scopedCoordinatorState.patientId === patientId &&
    scopedCoordinatorState.contextEpoch === activeContextEpoch
      ? scopedCoordinatorState
      : null;

  const context = useMemo<DataContextValue>(
    () => ({
      database,
      clinicalStore,
      patientId,
      repository,
      coordinator,
      notificationAdapter,
      remindersRevision,
      scopedCoordinatorState: validScopedCoordinatorState,
      bumpRemindersRevision,
      saving,
      formStorageReady,
      formImportStatus,
      formImportError,
      formImportWarning,
      retryFormImport,
      reconcileReminders,
      retryPendingNotification,
      isClosing,
      closeActiveContext,
      selectPatient,
      trackOperation,
      activeTeardownPromise: manager.getActiveTeardownPromise(),
      assistantController: manager.assistantController,
      sessionAdapter: manager.sessionAdapter,
      manager,
      identitySession,
      devices,
      sharedAgenda,
      agendaCoordinator,
      agendaBackgroundReady,
      prepareAgenda,
      runSave,
      changePatient,
    }),
    [
      database,
      clinicalStore,
      patientId,
      repository,
      coordinator,
      notificationAdapter,
      remindersRevision,
      validScopedCoordinatorState,
      bumpRemindersRevision,
      saving,
      isClosing,
      formStorageReady,
      formImportStatus,
      formImportError,
      formImportWarning,
      retryFormImport,
      reconcileReminders,
      retryPendingNotification,
      closeActiveContext,
      selectPatient,
      trackOperation,
      runSave,
      changePatient,
      manager,
      identitySession,
      devices,
      sharedAgenda,
      agendaCoordinator,
      agendaBackgroundReady,
      prepareAgenda,
    ],
  );

  if (error)
    return (
      <Screen title="Almacenamiento no disponible">
        <BodyText>{error}</BodyText>
        <VisualButton
          label="Reintentar apertura"
          onPress={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      </Screen>
    );
  if (!sessionRestored || (!labOnly && patientId && !database)) return <AppLoadingScreen />;

  return (
    <QueryRevisionContext.Provider value={queryRevision}>
      <ClinicalRevisionContext.Provider value={clinicalRevision}>
        <EducationContentRevisionContext.Provider value={educationContentRevision}>
          <EducationStatusRevisionContext.Provider value={educationStatusRevision}>
            <FormsRevisionContext.Provider value={formsRevision}>
              <RemindersRevisionContext.Provider value={remindersRevision}>
                <DataContext.Provider value={context}>
                  <AutomaticEducationDownloads>{children}</AutomaticEducationDownloads>
                </DataContext.Provider>
              </RemindersRevisionContext.Provider>
            </FormsRevisionContext.Provider>
          </EducationStatusRevisionContext.Provider>
        </EducationContentRevisionContext.Provider>
      </ClinicalRevisionContext.Provider>
    </QueryRevisionContext.Provider>
  );
}

export function useLocalData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) throw new Error('LocalDataProvider no está disponible.');
  return context;
}

export function useOptionalLocalData() {
  return useContext(DataContext);
}
