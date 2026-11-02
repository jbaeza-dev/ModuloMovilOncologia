import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { QueryRevisionContext } from '../../providers/QueryRevision';
import { useLocalData } from '../../providers/LocalDataProvider';
import { createAutomaticDownloadQueue } from './automatic-download-queue';
import { runBulkInfographicDownload } from './bulk-download-coordinator';
import { createReplicatedEducationReader } from './replicated-education-reader';

const StatusContext = createContext<'working' | 'ready' | 'pending' | null>(null);
export const useAutomaticEducationStatus = () => useContext(StatusContext);

export function AutomaticEducationDownloads({ children }: { children: ReactNode }) {
  const { patientId, repository, database, isClosing, trackOperation } = useLocalData();
  const revision = useContext(QueryRevisionContext);
  const [state, setState] = useState<'working' | 'ready' | 'pending' | null>(null);
  const queue = useRef<ReturnType<typeof createAutomaticDownloadQueue> | null>(null);
  useEffect(() => {
    setState(null);
    if (!patientId || !repository || !database || isClosing) return;
    let active = true;
    const current = createAutomaticDownloadQueue({
      fingerprint: async () => {
        const status = await repository.replicatedCatalog.status();
        if (!status?.completed_at) return null;
        return JSON.stringify(await repository.replicatedCatalog.education());
      },
      run: (signal) =>
        trackOperation(() =>
          runBulkInfographicDownload({
            patientId,
            repository,
            database,
            signal,
            catalogReader: createReplicatedEducationReader(repository.replicatedCatalog),
          }),
        ),
      onState: (next) => {
        if (active) setState(next);
      },
    });
    queue.current = current;
    current.request();
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') current.request(true);
    });
    const network = Network.addNetworkStateListener((next) => {
      if (next.isConnected && next.isInternetReachable !== false) current.request(true);
    });
    return () => {
      active = false;
      current.stop();
      if (queue.current === current) queue.current = null;
      app.remove();
      network.remove();
    };
  }, [patientId, repository, database, isClosing, trackOperation]);
  useEffect(() => {
    queue.current?.request();
  }, [revision]);
  return <StatusContext.Provider value={state}>{children}</StatusContext.Provider>;
}
