import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocalData } from '../../providers/LocalDataProvider';
import {
  cancelActiveBulkDownload,
  getActiveBulkDownload,
  runBulkInfographicDownload,
  type BulkDownloadProgress,
  type BulkDownloadResult,
} from './bulk-download-coordinator';

export interface UseBulkInfographicDownloadResult {
  isDownloading: boolean;
  isCancelling: boolean;
  progress: BulkDownloadProgress | null;
  summaryMessage: string | null;
  error: string | null;
  hasPending: boolean;
  lastResult: BulkDownloadResult | null;
  startDownload: () => Promise<BulkDownloadResult | null>;
  cancelDownload: () => void;
  clearSummary: () => void;
}

export function useBulkInfographicDownload(
  onComplete?: () => void,
): UseBulkInfographicDownloadResult {
  const { patientId, repository, database, trackOperation, isClosing } = useLocalData();

  const [isDownloading, setIsDownloading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<BulkDownloadProgress | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<BulkDownloadResult | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Al montar o cambiar de paciente: si ya existe una descarga en curso para este paciente,
  // suscribirse a su progreso y recuperar su estado para dar continuidad a la pantalla
  useEffect(() => {
    if (!patientId) {
      setIsDownloading(false);
      setProgress(null);
      return;
    }

    const activeSession = getActiveBulkDownload(patientId);
    if (!activeSession) {
      return;
    }

    setIsDownloading(true);
    setIsCancelling(activeSession.isCancelled());
    const currentProg = activeSession.getProgress();
    if (currentProg) {
      setProgress(currentProg);
    }

    const unsubscribe = activeSession.subscribe((p) => {
      setProgress(p);
      setIsCancelling(activeSession.isCancelled());
    });

    activeSession.promise
      .then((res) => {
        setLastResult(res);
        setSummaryMessage(res.message);
        onComplete?.();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Error en la descarga de infografías.');
      })
      .finally(() => {
        setIsDownloading(false);
        setIsCancelling(false);
        setProgress(null);
      });

    return () => {
      unsubscribe();
    };
  }, [patientId, onComplete]);

  // Si el contexto del paciente entra en proceso de cierre (logout o cambio de paciente),
  // solicitar la cancelación limpia de cualquier descarga activa
  useEffect(() => {
    if (isClosing && patientId) {
      cancelActiveBulkDownload(patientId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    }
  }, [isClosing, patientId]);

  const cancelDownload = useCallback(() => {
    setIsCancelling(true);
    if (patientId) {
      cancelActiveBulkDownload(patientId);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, [patientId]);

  const clearSummary = useCallback(() => {
    setSummaryMessage(null);
    setLastResult(null);
    setError(null);
  }, []);

  const startDownload = useCallback(async (): Promise<BulkDownloadResult | null> => {
    if (!patientId || !repository || !database || isDownloading || isClosing) {
      return null;
    }

    setIsDownloading(true);
    setIsCancelling(false);
    setProgress(null);
    setSummaryMessage(null);
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await trackOperation(async () => {
        return await runBulkInfographicDownload({
          patientId,
          repository,
          database,
          signal: controller.signal,
          onProgress: (p) => setProgress(p),
        });
      });

      setLastResult(result);
      setSummaryMessage(result.message);
      if (result.errors && result.errors.length > 0 && result.downloaded === 0) {
        setError(result.errors.map((e) => `${e.title}: ${e.message}`).join('; '));
      }
      onComplete?.();
      return result;
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Ocurrió un error inesperado durante la descarga de infografías.';
      setError(errMsg);
      return null;
    } finally {
      setIsDownloading(false);
      setIsCancelling(false);
      setProgress(null);
      abortControllerRef.current = null;
    }
  }, [patientId, repository, database, isDownloading, isClosing, trackOperation, onComplete]);

  const hasPending = Boolean(
    lastResult &&
    lastResult.pendingResources &&
    lastResult.pendingResources.length > 0 &&
    !lastResult.alreadyUpToDate,
  );

  return {
    isDownloading,
    isCancelling,
    progress,
    summaryMessage,
    error,
    hasPending,
    lastResult,
    startDownload,
    cancelDownload,
    clearSummary,
  };
}
