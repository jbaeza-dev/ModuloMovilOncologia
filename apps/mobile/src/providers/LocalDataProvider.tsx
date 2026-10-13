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
import { AppState, Text } from 'react-native';

import { Screen } from '../components/Screen';
import { BodyText, InfoCard, VisualButton } from '../components/Visual';
import { createExpoConnection } from '../data/local/core/expo-connection';
import { ExpoFileStorageAdapter } from '../data/local/files/file-storage-adapter';
import { migrateDatabase } from '../data/local/migrations';
import { createPatientRepository, seedPatientContextIfEmpty } from '../data/local/repository';
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
  { id: '11111111-1111-4111-8111-111111111111', label: 'Paciente de prueba A' },
  { id: '22222222-2222-4222-8222-222222222222', label: 'Paciente de prueba B' },
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
  formStorageReady: boolean;
  formImportStatus: PreparationStatus;
  formImportError: string | null;
  formImportWarning: FormImportWarning | null;
  retryFormImport: () => Promise<void>;
  reconcileReminders: (targetPatientId?: string) => Promise<CoordinatorResult | undefined>;
  runSave: <T>(work: () => Promise<T>) => Promise<T>;
  changePatient: () => void;
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

  const inFlightNotificationsRef = useRef<Set<string>>(new Set());
  const completedNotificationsRef = useRef<Set<string>>(new Set());
  const pendingNotificationIntentRef = useRef<PendingNotificationIntent | null>(null);

  const handleNotificationOpen = useCallback(
    async (payload: NotificationJobPayload, dedupeKey?: string): Promise<boolean> => {
      let navigatedSuccessfully = false;
      try {
        const currentId = patientIdRef.current;
        if (!currentId || currentId !== payload.pacienteId) {
          // Si el paciente activo no coincide, conservar la intención junto con su clave original
          if (dedupeKey) {
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

        // Comprobar si el paciente cambió durante la consulta a SQLite
        if (patientIdRef.current !== currentId) {
          if (dedupeKey) {
            pendingNotificationIntentRef.current = { payload, dedupeKey };
          }
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
        if (patientIdRef.current !== currentId) {
          if (dedupeKey) {
            pendingNotificationIntentRef.current = { payload, dedupeKey };
          }
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
      async runSave<T>(work: () => Promise<T>) {
        if (!patientId || savingRef.current) throw new Error('Selecciona un paciente de prueba.');
        savingRef.current = true;
        setSaving(true);
        try {
          return await work();
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      },
      changePatient() {
        if (savingRef.current) return;
        const previousPatientId = patientId;
        setPatientId(null);
        if (coordinator && previousPatientId) {
          void coordinator.cancelPatientSchedule(previousPatientId);
        }
      },
    }),
    [
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

  return (
    <DataContext.Provider value={context}>
      {isDemoMode() && !patientId ? (
        <Screen title="Selecciona un paciente de prueba">
          <InfoCard>
            <Text>Solo se utilizarán datos sintéticos guardados en este dispositivo.</Text>
            <BodyText>La selección no representa una sesión autenticada.</BodyText>
          </InfoCard>
          {DEMO_PATIENTS.map((patient) => (
            <VisualButton
              key={patient.id}
              label={patient.label}
              onPress={() => setPatientId(patient.id)}
            />
          ))}
        </Screen>
      ) : !isDemoMode() && !patientId ? (
        <Screen title="Sesión requerida">
          <InfoCard>
            <BodyText>
              Para utilizar la aplicación en modo estándar se requiere una sesión activa o vincular
              una cuenta de paciente.
            </BodyText>
            <BodyText>
              Los servicios de autenticación y sincronización con el servidor central se integrarán
              en una etapa posterior tras la aprobación del contrato OpenAPI.
            </BodyText>
          </InfoCard>
        </Screen>
      ) : (
        <>{children}</>
      )}
    </DataContext.Provider>
  );
}

export function useLocalData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) throw new Error('LocalDataProvider no está disponible.');
  return context;
}
