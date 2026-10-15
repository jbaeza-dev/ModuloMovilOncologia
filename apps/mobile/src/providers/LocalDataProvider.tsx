import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
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

import { Screen } from '../components/Screen';
import { BodyText, VisualButton } from '../components/Visual';
import { createExpoConnection } from '../data/local/core/expo-connection';
import { ExpoFileStorageAdapter } from '../data/local/files/file-storage-adapter';
import { migrateDatabase } from '../data/local/migrations';
import {
  createPatientRepository,
  seedDemoVitalsAndSymptoms,
  seedPatientContextIfEmpty,
} from '../data/local/repository';
import type { SqlConnection } from '../data/local/core/sql';
import { importLegacyDrafts } from '../features/medical-forms/form-legacy-import';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { isDemoMode } from '../utils/environment';
import {
  isValidNotificationPayload,
  ALLOWED_NOTIFICATION_DESTINATIONS as ALLOWED_DESTINATIONS,
  type NotificationJobPayload,
} from '../data/local/reminders/reminder-types';
import { ExpoNotificationAdapter } from '../services/notifications/expo-notification-adapter';
import {
  NotificationCoordinator,
  type CoordinatorResult,
} from '../services/reminders/notification-coordinator';
import { AssistantController } from '../services/assistant/assistant-controller';
import { FakeAssistantAdapter } from '../services/assistant/fake-assistant-adapter';
import { UnconfiguredAssistantAdapter } from '../services/assistant/unconfigured-assistant-adapter';

import { DemoSessionAdapter, DEMO_USERS } from '../services/session/demo-session-adapter';
import { UnconfiguredSessionAdapter } from '../services/session/unconfigured-session-adapter';
import type { SessionAdapter } from '../services/session/session-adapter';

interface PendingNotificationIntent {
  payload: NotificationJobPayload;
  dedupeKey: string;
}

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
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

export type CloseReason = 'change_patient' | 'manual_close' | 'session_required';

export type TeardownResult = {
  success: boolean;
  cancelledPatientId: string | null;
  pendingNotificationsCount: number;
  error?: string;
};

type Repository = ReturnType<typeof createPatientRepository>;
type DataContextValue = {
  database: SqlConnection | null;
  patientId: string | null;
  repository: Repository | null;
  coordinator: NotificationCoordinator | null;
  saving: boolean;
  isClosing: boolean;
  formStorageReady: boolean;
  formImportStatus: PreparationStatus;
  formImportError: string | null;
  formImportWarning: FormImportWarning | null;
  retryFormImport: () => Promise<void>;
  reconcileReminders: (targetPatientId?: string) => Promise<CoordinatorResult | undefined>;
  runSave: <T>(work: () => Promise<T>) => Promise<T>;
  trackOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  closeActiveContext: (reason?: CloseReason) => Promise<TeardownResult>;
  selectPatient: (newPatientId: string) => Promise<void>;
  changePatient: () => void;
  activeTeardownPromise: Promise<TeardownResult> | null;
  assistantController?: AssistantController | null;
  sessionAdapter: SessionAdapter;
};

const DataContext = createContext<DataContextValue | null>(null);

export function LocalDataProvider({ children }: { children: ReactNode }) {
  const [database, setDatabase] = useState<SqlConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [formImportStatus, setFormImportStatus] = useState<PreparationStatus>('idle');
  const [formImportError, setFormImportError] = useState<string | null>(null);
  const [formImportWarning, setFormImportWarning] = useState<FormImportWarning | null>(null);
  const [importAttempt, setImportAttempt] = useState(0);

  const retryFormImport = useCallback(async () => {
    setImportAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    let active = true;
    async function open() {
      let native: SQLite.SQLiteDatabase | null = null;
      try {
        native = await SQLite.openDatabaseAsync('quimiocare_local.db');
        const connection = createExpoConnection(native);
        await migrateDatabase(connection);
        if (isDemoMode()) {
          await seedPatientContextIfEmpty(connection, DEMO_PATIENTS[0].id, DEMO_PATIENTS[1].id);
          await seedDemoVitalsAndSymptoms(connection, DEMO_PATIENTS[0].id, DEMO_PATIENTS[1].id);
        }
        if (active) setDatabase(connection);
        else await native.closeAsync();
      } catch (failure) {
        if (native) await native.closeAsync().catch(() => undefined);
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : 'No se pudo abrir el almacenamiento local.',
          );
      }
    }
    void open();
    return () => {
      active = false;
    };
  }, [attempt]);

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
    importLegacyDrafts(patientId, database, adapter, undefined, Crypto.randomUUID)
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
  }, [database, patientId, importAttempt]);

  const patientIdRef = useRef<string | null>(patientId);
  useEffect(() => {
    patientIdRef.current = patientId;
  }, [patientId]);

  const formStorageReady = formImportStatus === 'ready';

  const repository = useMemo(
    () =>
      database && patientId
        ? createPatientRepository(database, patientId, Crypto.randomUUID)
        : null,
    [database, patientId],
  );

  const notificationAdapter = useMemo(() => new ExpoNotificationAdapter(), []);
  const coordinator = useMemo(
    () =>
      database
        ? new NotificationCoordinator(
            database,
            notificationAdapter,
            undefined,
            undefined,
            () => patientIdRef.current,
          )
        : null,
    [database, notificationAdapter],
  );

  const contextEpochRef = useRef<number>(0);
  const activeOperationsRef = useRef<number>(0);
  const drainResolversRef = useRef<Set<() => void>>(new Set());
  const activeTeardownPromiseRef = useRef<Promise<TeardownResult> | null>(null);

  const sessionAdapter = useMemo<SessionAdapter>(() => {
    return isDemoMode() ? new DemoSessionAdapter() : new UnconfiguredSessionAdapter();
  }, []);

  const assistantAdapter = useMemo(() => {
    return isDemoMode() ? new FakeAssistantAdapter() : new UnconfiguredAssistantAdapter();
  }, []);

  const closeActiveContextRef = useRef<(reason?: CloseReason) => Promise<TeardownResult>>(() =>
    Promise.resolve({ success: true, cancelledPatientId: null, pendingNotificationsCount: 0 }),
  );

  const assistantControllerRef = useRef<AssistantController | null>(null);
  if (!assistantControllerRef.current) {
    assistantControllerRef.current = new AssistantController(
      assistantAdapter,
      patientIdRef.current,
      () => {
        void closeActiveContextRef.current('session_required');
      },
      () => Crypto.randomUUID(),
    );
  }

  const [isClosing, setIsClosing] = useState(false);
  const closingRef = useRef(false);

  const trackOperation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (closingRef.current) {
      throw new Error('Operación rechazada: el contexto se encuentra en proceso de cierre.');
    }
    activeOperationsRef.current += 1;
    try {
      return await operation();
    } finally {
      activeOperationsRef.current -= 1;
      if (activeOperationsRef.current === 0) {
        drainResolversRef.current.forEach((resolve) => resolve());
        drainResolversRef.current.clear();
      }
    }
  }, []);

  const closeActiveContext = useCallback(
    (reason: CloseReason = 'manual_close'): Promise<TeardownResult> => {
      if (activeTeardownPromiseRef.current) {
        return activeTeardownPromiseRef.current;
      }

      // --- FASE 1: TRANSICIÓN INMEDIATA (< 1 segundo, RNF-05 local) ---
      contextEpochRef.current += 1;
      const currentEpoch = contextEpochRef.current;
      const outgoingPatientId = patientIdRef.current;
      closingRef.current = true;
      setIsClosing(true);

      // 1. Invalidar identidad activa en ref y en React
      patientIdRef.current = null;
      setPatientId(null);

      // 2. Abortar solicitudes del asistente en vuelo y limpiar memoria
      assistantControllerRef.current?.abort();
      assistantControllerRef.current?.setContext(null, contextEpochRef.current);

      // 3. Limpiar intenciones de notificación pendientes y dedupe
      pendingNotificationIntentRef.current = null;
      inFlightNotificationsRef.current.clear();

      // 4. Redirección inmediata según motivo de salida
      if (reason === 'change_patient') {
        router.replace('/acceso/seleccionar-paciente');
      } else if (reason === 'session_required') {
        router.replace('/acceso?motivo=sesion_requerida');
      } else {
        router.replace('/acceso');
      }

      // --- FASE 2: DRENAJE SEGURO OBSERVABLE ---
      let resolveTeardown!: (res: TeardownResult) => void;
      const teardownPromise = new Promise<TeardownResult>((resolve) => {
        resolveTeardown = resolve;
      });
      activeTeardownPromiseRef.current = teardownPromise;

      queueMicrotask(() => {
        void (async () => {
          let cancelSuccess = true;
          let pendingCount = 0;
          let teardownError: string | undefined;

          try {
            // 1. Aguardar que concluyan las operaciones atómicas en curso sin truncarlas
            if (activeOperationsRef.current > 0) {
              await new Promise<void>((resolveDrain) => {
                drainResolversRef.current.add(resolveDrain);
              });
            }

            // 2. Cancelar agenda nativa del paciente saliente y registrar resultado exacto
            if (coordinator && outgoingPatientId) {
              try {
                const cancelResult = await coordinator.cancelPatientSchedule(outgoingPatientId);
                cancelSuccess = cancelResult.success && cancelResult.pendingCount === 0;
                pendingCount = cancelResult.pendingCount;
                if (!cancelSuccess) {
                  console.warn(
                    `[Teardown] Quedan ${pendingCount} cancelaciones pendientes para paciente saliente.`,
                  );
                }
              } catch (cancelErr) {
                cancelSuccess = false;
                pendingCount = -1;
                teardownError = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
                console.warn('[Teardown] Excepción en cancelación de agenda nativa:', cancelErr);
              }
            }

            // 3. Limpiar identidad en el adaptador de sesión
            try {
              await sessionAdapter.logout();
            } catch (sessionErr) {
              console.warn('[Teardown] Excepción al cerrar sesión en adaptador:', sessionErr);
            }
          } catch (err) {
            cancelSuccess = false;
            teardownError = err instanceof Error ? err.message : String(err);
            console.warn('[Teardown] Excepción en drenaje seguro:', err);
          } finally {
            const result: TeardownResult = {
              success: cancelSuccess,
              cancelledPatientId: outgoingPatientId,
              pendingNotificationsCount: pendingCount,
              error: teardownError,
            };

            if (activeTeardownPromiseRef.current === teardownPromise) {
              activeTeardownPromiseRef.current = null;
            }
            if (contextEpochRef.current === currentEpoch) {
              closingRef.current = false;
              setIsClosing(false);
            }

            resolveTeardown(result);
          }
        })();
      });

      return teardownPromise;
    },
    [coordinator, sessionAdapter],
  );

  closeActiveContextRef.current = closeActiveContext;

  const selectPatient = useCallback(
    async (newPatientId: string): Promise<void> => {
      // 1. Validar que la selección manual está autorizada en el adaptador de sesión
      if (!sessionAdapter.selectDemoPatient) {
        throw new Error(
          'La selección manual de paciente solo está disponible en modo demostración.',
        );
      }
      const sessionResult = await sessionAdapter.selectDemoPatient(newPatientId);
      if (!sessionResult.success) {
        throw new Error(
          sessionResult.error ?? `Paciente '${newPatientId}' no válido para demostración.`,
        );
      }

      // 2. Si ya hay un cierre en curso, esperar que concluya el drenaje
      if (activeTeardownPromiseRef.current) {
        await activeTeardownPromiseRef.current;
      }

      // 3. Si existe otro paciente activo, forzar y esperar su cierre de contexto antes de activar B
      const currentActiveId = patientIdRef.current;
      if (currentActiveId && currentActiveId !== newPatientId) {
        await closeActiveContext('change_patient');
      }

      // 4. Activar el nuevo contexto
      contextEpochRef.current += 1;
      patientIdRef.current = newPatientId;
      setPatientId(newPatientId);
      assistantControllerRef.current?.setContext(newPatientId, contextEpochRef.current);

      // 5. Navegar hacia (tabs) una vez que la guarda del nuevo contexto está habilitada
      router.replace('/(tabs)');
    },
    [closeActiveContext, sessionAdapter],
  );

  const changePatient = useCallback(() => {
    void closeActiveContext('change_patient');
  }, [closeActiveContext]);

  const inFlightNotificationsRef = useRef<Set<string>>(new Set());
  const completedNotificationsRef = useRef<Set<string>>(new Set());
  const pendingNotificationIntentRef = useRef<PendingNotificationIntent | null>(null);

  const handleNotificationOpen = useCallback(
    async (payload: NotificationJobPayload, dedupeKey?: string): Promise<boolean> => {
      let navigatedSuccessfully = false;
      try {
        const startEpoch = contextEpochRef.current;
        const currentId = patientIdRef.current;
        if (closingRef.current || !currentId || currentId !== payload.pacienteId) {
          // Si el paciente activo no coincide, conservar la intención solo si no estamos en cierre y la época coincide
          if (dedupeKey && !closingRef.current && contextEpochRef.current === startEpoch) {
            pendingNotificationIntentRef.current = { payload, dedupeKey };
          }
          return false;
        }

        if (!database) return false;

        // Validar contra SQLite que la notificación existe para este paciente y coinciden los campos
        const row = await database.first<{
          id: string;
          paciente_id: string;
          recordatorio_id: string;
          revision: number;
          tipo: string;
        }>(
          'SELECT id, paciente_id, recordatorio_id, revision, tipo FROM notificacion_local WHERE id = ? AND paciente_id = ?',
          [payload.notificacionId, currentId],
        );

        // Comprobar si el contexto cambió o está en cierre durante la consulta a SQLite
        if (
          patientIdRef.current !== currentId ||
          contextEpochRef.current !== startEpoch ||
          closingRef.current
        ) {
          return false;
        }

        if (!row) {
          return false;
        }

        if (
          row.recordatorio_id !== payload.recordatorioId ||
          row.revision !== payload.revision ||
          row.tipo !== payload.tipo
        ) {
          return false;
        }

        // Marcar como abierta en SQLite
        await database.run(
          'UPDATE notificacion_local SET abierta_en = ? WHERE id = ? AND paciente_id = ? AND abierta_en IS NULL',
          [new Date().toISOString(), payload.notificacionId, currentId],
        );

        // Comprobar nuevamente tras la actualización en SQLite
        if (
          patientIdRef.current !== currentId ||
          contextEpochRef.current !== startEpoch ||
          closingRef.current
        ) {
          return false;
        }

        // Resolver destino mediante lista permitida y navegar
        if (ALLOWED_DESTINATIONS.has(payload.destino)) {
          router.push(payload.destino as Parameters<typeof router.push>[0]);
          navigatedSuccessfully = true;
          return true;
        }
        return false;
      } catch (err) {
        console.warn('Fallo transitorio al procesar apertura de notificación:', err);
        return false;
      } finally {
        if (dedupeKey) {
          inFlightNotificationsRef.current.delete(dedupeKey);
          if (navigatedSuccessfully) {
            completedNotificationsRef.current.add(dedupeKey);
          }
        }
      }
    },
    [database],
  );

  // Procesar intención de navegación pendiente cuando el paciente coincida
  useEffect(() => {
    if (patientId && pendingNotificationIntentRef.current) {
      if (pendingNotificationIntentRef.current.payload.pacienteId === patientId) {
        const { payload, dedupeKey } = pendingNotificationIntentRef.current;
        if (
          !completedNotificationsRef.current.has(dedupeKey) &&
          !inFlightNotificationsRef.current.has(dedupeKey)
        ) {
          inFlightNotificationsRef.current.add(dedupeKey);
          void handleNotificationOpen(payload, dedupeKey)
            .then((success) => {
              if (success) {
                if (pendingNotificationIntentRef.current?.dedupeKey === dedupeKey) {
                  pendingNotificationIntentRef.current = null;
                }
              }
            })
            .catch((err) => {
              console.warn('Error en handleNotificationOpen pendiente:', err);
            });
        }
      }
    }
  }, [patientId, handleNotificationOpen]);

  const reconcileReminders = useCallback(
    async (targetPatientId?: string): Promise<CoordinatorResult | undefined> => {
      const currentId = targetPatientId ?? patientIdRef.current;
      if (!coordinator || !currentId) return undefined;
      return await coordinator.reconcile(currentId, () => patientIdRef.current === currentId);
    },
    [coordinator],
  );

  // Reconciliación al seleccionar paciente
  useEffect(() => {
    if (patientId && coordinator) {
      void reconcileReminders();
    }
  }, [patientId, coordinator, reconcileReminders]);

  // Reconciliación al volver a primer plano (AppState active)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && patientIdRef.current && coordinator) {
        void reconcileReminders();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [coordinator, reconcileReminders]);

  // Manejo de eventos y toques de notificaciones locales
  useEffect(() => {
    if (!database) return;

    // Procesar respuesta previa de arranque (cold start)
    try {
      const last = Notifications.getLastNotificationResponse();
      if (last) {
        Notifications.clearLastNotificationResponse();
        const data = last.notification.request.content.data;
        const identifier = last.notification.request.identifier;
        if (isValidNotificationPayload(data)) {
          const dedupeKey = `${data.notificacionId}:${identifier || 'cold'}`;
          if (
            !completedNotificationsRef.current.has(dedupeKey) &&
            !inFlightNotificationsRef.current.has(dedupeKey)
          ) {
            inFlightNotificationsRef.current.add(dedupeKey);
            void handleNotificationOpen(data, dedupeKey).catch((err) => {
              console.warn('Error en handleNotificationOpen cold start:', err);
            });
          }
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
        if (isValidNotificationPayload(data)) {
          const dedupeKey = `${data.notificacionId}:${identifier || 'listener'}`;
          if (
            !completedNotificationsRef.current.has(dedupeKey) &&
            !inFlightNotificationsRef.current.has(dedupeKey)
          ) {
            inFlightNotificationsRef.current.add(dedupeKey);
            void handleNotificationOpen(data, dedupeKey).catch((err) => {
              console.warn('Error en handleNotificationOpen listener:', err);
            });
          }
        }
      });

      receivedSub = Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data;
        if (isValidNotificationPayload(data)) {
          const currentId = patientIdRef.current;
          if (currentId && data.pacienteId === currentId && repository) {
            void repository.reminders.recordNotificationObserved(data.notificacionId);
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
  }, [database, repository, handleNotificationOpen]);

  const context = useMemo<DataContextValue>(
    () => ({
      database,
      patientId,
      repository,
      coordinator,
      saving,
      formStorageReady,
      formImportStatus,
      formImportError,
      formImportWarning,
      retryFormImport,
      reconcileReminders,
      isClosing,
      closeActiveContext,
      selectPatient,
      trackOperation,
      activeTeardownPromise: activeTeardownPromiseRef.current,
      assistantController: assistantControllerRef.current,
      sessionAdapter,
      async runSave<T>(work: () => Promise<T>): Promise<T> {
        return trackOperation(async () => {
          if (!patientIdRef.current || savingRef.current) {
            throw new Error('Selecciona un paciente de prueba.');
          }
          savingRef.current = true;
          setSaving(true);
          try {
            return await work();
          } finally {
            savingRef.current = false;
            setSaving(false);
          }
        });
      },
      changePatient,
    }),
    [
      database,
      patientId,
      repository,
      coordinator,
      saving,
      isClosing,
      formStorageReady,
      formImportStatus,
      formImportError,
      formImportWarning,
      retryFormImport,
      reconcileReminders,
      closeActiveContext,
      selectPatient,
      trackOperation,
      changePatient,
      sessionAdapter,
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
  if (!database)
    return (
      <Screen title="Preparando almacenamiento">
        <BodyText>Abriendo la base de datos local…</BodyText>
      </Screen>
    );

  return <DataContext.Provider value={context}>{children}</DataContext.Provider>;
}

export function useLocalData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) throw new Error('LocalDataProvider no está disponible.');
  return context;
}
