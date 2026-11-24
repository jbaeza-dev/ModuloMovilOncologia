import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { SqlConnection } from '../data/local/core/sql';
import { openClinicalStore, type ClinicalStore } from '../data/sync/native-runtime';
import type { HttpSessionAdapter } from '../services/session/http-session-adapter';
import type { PatientContextManager } from './patient-context-manager';
import { devWarn } from '../services/diagnostics/dev-warn';

type OpenedStore = { store: ClinicalStore; epoch: number };

/**
 * Abre la base cifrada del paciente activo (una por cuenta y entorno), la cierra cuando cambia el
 * contexto y cuenta revisiones por grupo de tablas para que las consultas reactivas se refresquen.
 * Solo entrega el almacén si pertenece a la época, al paciente y a la cuenta actuales.
 */
export function useClinicalStore({
  manager,
  identitySession,
  patientId,
  contextEpoch,
  sessionRestored,
  labOnly,
}: {
  manager: PatientContextManager;
  identitySession: HttpSessionAdapter | null;
  patientId: string | null;
  contextEpoch: number;
  sessionRestored: boolean;
  labOnly: boolean;
}) {
  const [storage, setStorage] = useState<OpenedStore | null>(null);
  const [clinicalRevision, setClinicalRevision] = useState(0);
  const [educationContentRevision, setEducationContentRevision] = useState(0);
  const [educationStatusRevision, setEducationStatusRevision] = useState(0);
  const [formsRevision, setFormsRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const openJobs = useRef<Promise<void>>(Promise.resolve());

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
          const watch = (tables: string[], bump: () => void) =>
            store.database.onChange(
              {
                onChange: () => {
                  if (active) bump();
                },
              },
              { tables, throttleMs: 150 },
            );
          const unwatchAll = [
            watch(['signos_vitales', 'qc_clinical_command', 'qc_gateway_outbox'], () =>
              setClinicalRevision((n) => n + 1),
            ),
            watch(['qc_storage_control'], () => setEducationContentRevision((n) => n + 1)),
            watch(['descarga', 'interaccion_educativa_local', 'qc_catalog_status'], () =>
              setEducationStatusRevision((n) => n + 1),
            ),
            watch(['qc_definition_snapshot', 'respuesta_formulario', 'qc_clinical_command'], () =>
              setFormsRevision((n) => n + 1),
            ),
          ];
          unwatch = () => unwatchAll.forEach((stop) => stop());
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

  const retryOpen = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const clinicalStore =
    storage &&
    storage.epoch === contextEpoch &&
    !storage.store.closed &&
    storage.store.scope.localPatientId === patientId &&
    storage.store.scope.owner === identitySession?.getCurrentUser()?.id
      ? storage.store
      : null;

  return {
    storage,
    clinicalStore,
    error,
    retryOpen,
    clinicalRevision,
    educationContentRevision,
    educationStatusRevision,
    formsRevision,
  };
}

/** Suspende la sincronización en segundo plano y la reanuda al volver a primer plano. */
export function useSyncPauseOnBackground(
  storage: OpenedStore | null,
  database: SqlConnection | null,
  patientId: string | null,
) {
  useEffect(() => {
    if (!database || !patientId) return;
    const store = storage?.store;
    if (!store || store.closed) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (store.closed) return;
      if (state === 'active') {
        if (typeof store.resume === 'function') {
          void store.resume(false).catch((err) => {
            devWarn('Error al reanudar sincronización al volver a primer plano:', err);
          });
        }
      } else if (state === 'background' || state === 'inactive') {
        if (typeof store.disconnect === 'function') {
          void store.disconnect().catch((err) => {
            devWarn('Error al suspender sincronización en segundo plano:', err);
          });
        }
      }
    });
    return () => {
      sub.remove();
    };
  }, [database, patientId, storage]);
}
