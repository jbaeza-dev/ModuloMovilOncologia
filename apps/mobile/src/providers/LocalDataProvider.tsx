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
import { router, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';

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
import { isDemoMode } from '../utils/environment';
import { isValidNotificationPayload } from '../data/local/reminders/reminder-types';
import { ExpoNotificationAdapter } from '../services/notifications/expo-notification-adapter';
import {
  NotificationCoordinator,
  type CoordinatorResult,
} from '../services/reminders/notification-coordinator';
import type { AssistantController } from '../services/assistant/assistant-controller';
import { FakeAssistantAdapter } from '../services/assistant/fake-assistant-adapter';
import { UnconfiguredAssistantAdapter } from '../services/assistant/unconfigured-assistant-adapter';

import { DemoSessionAdapter, DEMO_USERS } from '../services/session/demo-session-adapter';
import { UnconfiguredSessionAdapter } from '../services/session/unconfigured-session-adapter';
import type { SessionAdapter } from '../services/session/session-adapter';
import {
  PatientContextManager,
  type CloseReason,
  type TeardownResult,
  type RouterAdapter,
  type NotificationOpenResult,
} from './patient-context-manager';

export type { CloseReason, TeardownResult, NotificationOpenResult };

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
  retryPendingNotification: () => Promise<NotificationOpenResult>;
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
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [formImportStatus, setFormImportStatus] = useState<PreparationStatus>('idle');
  const [formImportError, setFormImportError] = useState<string | null>(null);
  const [formImportWarning, setFormImportWarning] = useState<FormImportWarning | null>(null);
  const [importAttempt, setImportAttempt] = useState(0);

  const routerAdapter = useMemo<RouterAdapter>(
    () => ({
      replace: (route: string) => router.replace(route as Href),
      push: (route: string) => router.push(route as Href),
    }),
    [],
  );

  const sessionAdapter = useMemo<SessionAdapter>(() => {
    return isDemoMode() ? new DemoSessionAdapter() : new UnconfiguredSessionAdapter();
  }, []);

  const assistantAdapter = useMemo(() => {
    return isDemoMode() ? new FakeAssistantAdapter() : new UnconfiguredAssistantAdapter();
  }, []);

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

  const patientId = manager.getPatientId();
  const isClosing = manager.getIsClosing();

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
      if (!coordinator || !currentId) return undefined;
      return await coordinator.reconcile(currentId, () => manager.getPatientId() === currentId);
    },
    [coordinator, manager],
  );

  // Reconciliación al seleccionar paciente
  useEffect(() => {
    if (patientId && coordinator) {
      void reconcileReminders();
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
          void reconcileReminders();
        }
      }
    });
    return () => {
      subscription.remove();
    };
  }, [coordinator, reconcileReminders, manager]);

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
        if (isValidNotificationPayload(data)) {
          const dedupeKey = `${data.notificacionId}:${identifier || 'listener'}`;
          void manager.handleNotificationOpen(data, dedupeKey).catch((err) => {
            console.warn('Error en handleNotificationOpen listener:', err);
          });
        }
      });

      receivedSub = Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data;
        if (isValidNotificationPayload(data)) {
          const currentId = manager.getPatientId();
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
  }, [database, repository, manager]);

  const runSave = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      return manager.trackOperation(async () => {
        if (!manager.getPatientId() || savingRef.current) {
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
    [manager],
  );

  const retryPendingNotification = useCallback(async (): Promise<NotificationOpenResult> => {
    return manager.processPendingNotificationIntent();
  }, [manager]);

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
      retryPendingNotification,
      isClosing,
      closeActiveContext,
      selectPatient,
      trackOperation,
      activeTeardownPromise: manager.getActiveTeardownPromise(),
      assistantController: manager.assistantController,
      sessionAdapter: manager.sessionAdapter,
      runSave,
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
      retryPendingNotification,
      closeActiveContext,
      selectPatient,
      trackOperation,
      runSave,
      changePatient,
      manager,
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
