import { useCallback, useRef, useState } from 'react';

import { useLocalData } from '../../providers/LocalDataProvider';
import {
  runBulkInfographicDownload,
  type BulkDownloadProgress,
  type BulkDownloadResult,
} from './bulk-download-coordinator';

export interface UseBulkInfographicDownloadResult {
  isDownloading: boolean;
  progress: BulkDownloadProgress | null;
  summaryMessage: string | null;
  error: string | null;
  startDownload: () => Promise<BulkDownloadResult | null>;
  cancelDownload: () => void;
  clearSummary: () => void;
}

export function useBulkInfographicDownload(
  onComplete?: () => void,
): UseBulkInfographicDownloadResult {
  const { patientId, repository, database } = useLocalData();

  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<BulkDownloadProgress | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelDownload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const clearSummary = useCallback(() => {
    setSummaryMessage(null);
  }, []);

  const startDownload = useCallback(async (): Promise<BulkDownloadResult | null> => {
    if (!patientId || !repository || !database || isDownloading) {
      return null;
    }

    setIsDownloading(true);
    setProgress(null);
    setSummaryMessage(null);
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await runBulkInfographicDownload({
        patientId,
        repository,
        database,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      setSummaryMessage(result.message);
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
      setProgress(null);
      abortControllerRef.current = null;
    }
  }, [patientId, repository, database, isDownloading, onComplete]);

  return {
    isDownloading,
    progress,
    summaryMessage,
    error,
    startDownload,
    cancelDownload,
    clearSummary,
  };
}
