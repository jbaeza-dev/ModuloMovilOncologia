import { useMemo } from 'react';
import * as Crypto from 'expo-crypto';
import { useLocalData } from '../../providers/LocalDataProvider';
import { createEproRepository } from '../../data/sync/epro-repository';

export function useEproRepository() {
  const { clinicalStore, identitySession } = useLocalData();
  return useMemo(() => {
    if (!clinicalStore || !identitySession) return null;
    return createEproRepository(clinicalStore.connection, clinicalStore.scope, {
      newId: () => Crypto.randomUUID(),
      assertContext: () => {
        if (
          clinicalStore.closed ||
          identitySession.getCurrentUser()?.id !== clinicalStore.scope.owner
        )
          throw new Error('La cuenta cambió durante el seguimiento.');
      },
    });
  }, [clinicalStore, identitySession]);
}
