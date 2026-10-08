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
import { Text } from 'react-native';

import { Screen } from '../components/Screen';
import { BodyText, InfoCard, VisualButton } from '../components/Visual';
import { createExpoConnection } from '../data/local/expo-connection';
import { ExpoFileStorageAdapter } from '../data/local/file-storage-adapter';
import { migrateDatabase } from '../data/local/migrations';
import { createPatientRepository, seedPatientContextIfEmpty } from '../data/local/repository';
import type { SqlConnection } from '../data/local/sql';
import { importLegacyDrafts } from '../features/medical-forms/form-legacy-import';
import { isDemoMode } from '../utils/environment';

export const DEMO_PATIENTS = [
  { id: '11111111-1111-4111-8111-111111111111', label: 'Paciente de prueba A' },
  { id: '22222222-2222-4222-8222-222222222222', label: 'Paciente de prueba B' },
] as const;

export type PreparationStatus = 'idle' | 'importing' | 'ready' | 'error';

type Repository = ReturnType<typeof createPatientRepository>;
type DataContextValue = {
  patientId: string | null;
  repository: Repository | null;
  saving: boolean;
  formStorageReady: boolean;
  formImportStatus: PreparationStatus;
  formImportError: string | null;
  retryFormImport: () => Promise<void>;
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
      return;
    }
    let active = true;
    setFormImportStatus('importing');
    setFormImportError(null);
    const adapter = new ExpoFileStorageAdapter();
    importLegacyDrafts(patientId, database, adapter, undefined, Crypto.randomUUID)
      .then(() => {
        if (active) {
          setFormImportStatus('ready');
          setFormImportError(null);
        }
      })
      .catch((err) => {
        console.warn('Fallo en importación legacy:', err);
        if (active) {
          setFormImportStatus('error');
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
  const context = useMemo<DataContextValue>(
    () => ({
      patientId,
      repository,
      saving,
      formStorageReady,
      formImportStatus,
      formImportError,
      retryFormImport,
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
        if (!savingRef.current) setPatientId(null);
      },
    }),
    [
      patientId,
      repository,
      saving,
      formStorageReady,
      formImportStatus,
      formImportError,
      retryFormImport,
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
