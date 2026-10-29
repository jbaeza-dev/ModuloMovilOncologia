import { useCallback, useMemo } from 'react';
import { BodyText } from '../../components/Visual';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { createReplicatedEducationReader } from './replicated-education-reader';
import { InMemoryEducationalCatalogReader } from './educational-catalog-service';
import { formatDate } from '../../data/local/repository';

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
  const { repository } = useLocalData();
  const load = useCallback(
    () => repository?.replicatedCatalog.status() ?? Promise.resolve(null),
    [repository],
  );
  const { value, loading, error } = useFocusedValue(load, null);
  return (
    <BodyText>
      {loading
        ? 'Consultando la réplica educativa…'
        : error
          ? 'No se pudo consultar el estado del catálogo.'
          : !value?.completed_at
            ? 'Aún no se recibió una réplica educativa completa. Conéctate para obtenerla.'
            : `Última réplica completa: ${formatDate(value.completed_at)}.${value.error_code ? ' La actualización falló; se conserva esa copia.' : ''} La fecha no confirma conexión actual. Los retiros se aplican cuando llega una nueva réplica.`}
    </BodyText>
  );
}
