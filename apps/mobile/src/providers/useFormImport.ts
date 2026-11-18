import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';

import type { SqlConnection } from '../data/local/core/sql';
import { cleanupRetiredEducationalCopies } from '../data/local/education/retired-copy-cleanup';
import { ExpoFileStorageAdapter } from '../data/local/files/file-storage-adapter';
import { importLegacyDrafts } from '../features/medical-forms/form-legacy-import';
import type { PatientContextManager } from './patient-context-manager';

export type PreparationStatus = 'idle' | 'importing' | 'ready' | 'error';
export type FormImportWarning = {
  errors: number;
  pendingCleanups: number;
};

/**
 * Al abrir la base del paciente importa los borradores de formularios guardados como archivos por
 * versiones anteriores y limpia copias educativas retiradas. Los formularios esperan a que termine.
 */
export function useFormImport({
  database,
  patientId,
  manager,
}: {
  database: SqlConnection | null;
  patientId: string | null;
  manager: PatientContextManager;
}) {
  const [formImportStatus, setFormImportStatus] = useState<PreparationStatus>('idle');
  const [formImportError, setFormImportError] = useState<string | null>(null);
  const [formImportWarning, setFormImportWarning] = useState<FormImportWarning | null>(null);
  const [importAttempt, setImportAttempt] = useState(0);

  const retryFormImport = useCallback(async () => {
    setImportAttempt((a) => a + 1);
  }, []);

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

  return {
    formImportStatus,
    formImportError,
    formImportWarning,
    retryFormImport,
    formStorageReady: formImportStatus === 'ready',
  };
}
