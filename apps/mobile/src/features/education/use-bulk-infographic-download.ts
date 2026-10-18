import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocalData } from '../../providers/LocalDataProvider';
import {
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

  // Vincular la ejecución al ciclo de vida del paciente: abortar si el contexto entra en cierre
  useEffect(() => {
    if (isClosing && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, [isClosing]);

  // Al desmontar o al cambiar de paciente, abortar cualquier descarga activa
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [patientId]);

  const cancelDownload = useCallback(() => {
    if (abortControllerRef.current) {
      setIsCancelling(true);
      abortControllerRef.current.abort();
    }
  }, []);

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
