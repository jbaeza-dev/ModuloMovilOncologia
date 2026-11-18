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

import { AppLoadingScreen } from '../components/AppLoadingScreen';
import { Screen } from '../components/Screen';
import { BodyText, VisualButton } from '../components/Visual';
import type { SqlConnection } from '../data/local/core/sql';
import { createPatientRepository } from '../data/local/repository';
import type { ClinicalStore } from '../data/sync/native-runtime';
import { AutomaticEducationDownloads } from '../features/education/AutomaticEducationDownloads';
import type { AgendaClient } from '../services/agenda/agenda-client';
import type { AgendaCoordinator } from '../services/agenda/agenda-coordinator';
import type { AssistantController } from '../services/assistant/assistant-controller';
import type { LocalNotificationAdapter } from '../services/notifications/notification-adapter';
import { ExpoNotificationAdapter } from '../services/notifications/expo-notification-adapter';
import {
  NotificationCoordinator,
  type CoordinatorResult,
} from '../services/reminders/notification-coordinator';
import { DEMO_USERS } from '../services/session/demo-session-adapter';
import type { DeviceClient } from '../services/session/device-client';
import type { HttpSessionAdapter } from '../services/session/http-session-adapter';
import type { SessionAdapter } from '../services/session/session-adapter';
import { isDemoMode } from '../utils/environment';
import './foreground-notices';
import {
  PatientContextManager,
  type CloseReason,
  type TeardownResult,
  type NotificationOpenResult,
} from './patient-context-manager';
import {
  QueryRevisionContext,
  ClinicalRevisionContext,
  EducationContentRevisionContext,
  EducationStatusRevisionContext,
  FormsRevisionContext,
  RemindersRevisionContext,
} from './QueryRevision';
import { useAgendaRuntime } from './useAgendaRuntime';
import { useClinicalStore, useSyncPauseOnBackground } from './useClinicalStore';
import { useFormImport, type FormImportWarning, type PreparationStatus } from './useFormImport';
import { useNotificationResponses } from './useNotificationResponses';
import { usePatientContext } from './usePatientContext';
import {
  useReminderReconciliation,
  type ScopedCoordinatorState,
} from './useReminderReconciliation';

export type { CloseReason, TeardownResult, NotificationOpenResult };
export type { ScopedCoordinatorState, PreparationStatus, FormImportWarning };

export const DEMO_PATIENTS = [
  { id: DEMO_USERS[0].id, label: DEMO_USERS[0].name },
  { id: DEMO_USERS[1].id, label: DEMO_USERS[1].name },
] as const;

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

/**
 * Estado global de datos de la app. Compone hooks con una responsabilidad cada uno:
 * - usePatientContext: sesión, dispositivos, asistente y administrador del contexto de paciente.
 * - useClinicalStore: apertura y cierre de la base cifrada, y revisiones por grupo de tablas.
 * - useAgendaRuntime: agenda compartida y coordinador nativo de avisos.
 * - useFormImport: importación de borradores antiguos de formularios.
 * - useReminderReconciliation: reprogramación de avisos al cambiar paciente, app o red.
 * - useNotificationResponses: avisos tocados o recibidos con la app abierta.
 */
export function LocalDataProvider({ children }: { children: ReactNode }) {
  const [sessionRestored, setSessionRestored] = useState(false);
  const [queryRevision] = useState(0);
  const restoreStarted = useRef(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [remindersRevision, setRemindersRevision] = useState(0);

  const bumpRemindersRevision = useCallback(() => {
    setRemindersRevision((r) => r + 1);
  }, []);

  const { manager, routerAdapter, identitySession, devices } = usePatientContext();

  const patientId = manager.getPatientId();
  const contextEpoch = manager.getContextEpoch();
  const isClosing = manager.getIsClosing();
  const labOnly =
    process.env.EXPO_PUBLIC_P04_LAB_ONLY === 'true' &&
    process.env.EXPO_PUBLIC_P04_PROBE_ENABLED === 'true' &&
    isDemoMode();

  const store = useClinicalStore({
    manager,
    identitySession,
    patientId,
    contextEpoch,
    sessionRestored,
    labOnly,
  });
  const clinicalStore = store.clinicalStore;
  const database = clinicalStore?.connection ?? null;

  const {
    sharedAgenda,
    agendaCoordinator,
    agendaBackgroundReady,
    prepareAgenda,
    ensureAgendaRuntime,
    activeAgendaCoordinator,
    stopAgenda,
  } = useAgendaRuntime({ identitySession, clinicalStore, manager, devices });

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

  const {
    formImportStatus,
    formImportError,
    formImportWarning,
    retryFormImport,
    formStorageReady,
  } = useFormImport({ database, patientId, manager });

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

  const { reconcileReminders, scopedCoordinatorState } = useReminderReconciliation({
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
  });

  useNotificationResponses({
    manager,
    repository,
    database,
    agendaCoordinator,
    bumpRemindersRevision,
  });

  useSyncPauseOnBackground(store.storage, database, patientId);

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

  const context = useMemo<DataContextValue>(
    () => ({
      database,
      clinicalStore,
      patientId,
      repository,
      coordinator,
      notificationAdapter,
      remindersRevision,
      scopedCoordinatorState,
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
      scopedCoordinatorState,
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

  if (store.error)
    return (
      <Screen title="Almacenamiento no disponible">
        <BodyText>{store.error}</BodyText>
        <VisualButton label="Reintentar apertura" onPress={store.retryOpen} />
      </Screen>
    );
  if (!sessionRestored || (!labOnly && patientId && !database)) return <AppLoadingScreen />;

  return (
    <QueryRevisionContext.Provider value={queryRevision}>
      <ClinicalRevisionContext.Provider value={store.clinicalRevision}>
        <EducationContentRevisionContext.Provider value={store.educationContentRevision}>
          <EducationStatusRevisionContext.Provider value={store.educationStatusRevision}>
            <FormsRevisionContext.Provider value={store.formsRevision}>
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
