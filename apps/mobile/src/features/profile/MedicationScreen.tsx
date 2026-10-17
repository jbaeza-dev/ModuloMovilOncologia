import { useCallback } from 'react';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  DetailRow,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import type { ActiveMedicationRecord } from '../../data/local/clinical-context/clinical-context-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';

export function MedicationScreen() {
  const { repository } = useLocalData();
  const load = useCallback(
    () => (repository ? repository.activeMedications() : Promise.resolve([])),
    [repository],
  );
  const {
    value: medications,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, [] as ActiveMedicationRecord[]);

  return (
    <Screen title="Medicación activa">
      <DemoBadge />
      <BodyText>
        Información de consulta local provista por tu centro de salud. No modifiques ni suspendas tu
        medicación sin indicación médica de tu oncólogo tratante.
      </BodyText>

      {loading ? (
        <InfoCard>
          <BodyText>Consultando medicamentos activos…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo consultar la medicación local.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !medications || medications.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="Sin medicamentos registrados"
          description="No se encontraron registros de medicación activa en el almacenamiento local para este paciente."
        />
      ) : (
        medications.map((med) => (
          <InfoCard key={med.id}>
            <SectionTitle>{med.nombre}</SectionTitle>
            <DetailRow label="Dosis" value={med.dosis} />
            <DetailRow label="Frecuencia" value={med.frecuencia} />
            {med.fecha_inicio ? <DetailRow label="Fecha inicio" value={med.fecha_inicio} /> : null}
            {med.fecha_fin ? <DetailRow label="Fecha fin" value={med.fecha_fin} /> : null}
            <StatusPill>
              Información en caché · Obtenido el {formatDate(med.obtenido_en)}
            </StatusPill>
          </InfoCard>
        ))
      )}

      <BodyText>
        Información en caché guardada en este dispositivo para consulta sin conexión.
      </BodyText>
    </Screen>
  );
}
