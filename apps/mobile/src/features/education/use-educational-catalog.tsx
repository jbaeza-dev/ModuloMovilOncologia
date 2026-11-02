import { useCallback, useMemo } from 'react';
import { BodyText } from '../../components/Visual';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { createReplicatedEducationReader } from './replicated-education-reader';
import { InMemoryEducationalCatalogReader } from './educational-catalog-service';
import { useAutomaticEducationStatus } from './AutomaticEducationDownloads';

const unavailable = new InMemoryEducationalCatalogReader([]);
export function useEducationalCatalog() {
  const { repository } = useLocalData();
  return useMemo(
    () =>
      repository ? createReplicatedEducationReader(repository.replicatedCatalog) : unavailable,
    [repository],
  );
}
export function CatalogStatusNotice() {
  const automatic = useAutomaticEducationStatus();
  const { repository } = useLocalData();
  const load = useCallback(
    () => repository?.replicatedCatalog.status() ?? Promise.resolve(null),
    [repository],
  );
  const { value, loading, error } = useFocusedValue(load, null);
  return (
    <BodyText>
      {automatic === 'working'
        ? 'Preparando tus infografías para verlas sin internet…'
        : automatic === 'pending'
          ? 'Quedan guías por preparar. Se reintentará automáticamente con conexión.'
          : loading
            ? 'Buscando tus guías de cuidado…'
            : error
              ? 'No se pudo consultar el estado del catálogo.'
              : !value?.completed_at
                ? 'Todavía no hemos recibido la biblioteca completa. Conéctate para recibirla por primera vez.'
                : 'Las infografías se guardan automáticamente. Videos y podcasts requieren internet.'}
    </BodyText>
  );
}
