import { useCallback } from 'react';
import { router } from 'expo-router';

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
import { formatCivilDateDisplay } from '../../services/reminders/reminder-status';

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
    <Screen title="Mis medicamentos">
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
          description="No se encontraron registros de medicamentos para este paciente en el almacenamiento local."
        />
      ) : (
        medications.map((med) => (
          <InfoCard key={med.id}>
            <SectionTitle>{med.nombre}</SectionTitle>
            <DetailRow label="Dosis" value={med.dosis} layout="vertical" />
            <DetailRow label="Frecuencia" value={med.frecuencia} layout="vertical" />
            {med.fecha_inicio ? (
              <DetailRow
                label="Fecha de inicio"
                value={formatCivilDateDisplay(med.fecha_inicio)}
                layout="vertical"
              />
            ) : null}
            {med.fecha_fin ? (
              <DetailRow
                label="Fecha de término"
                value={formatCivilDateDisplay(med.fecha_fin)}
                layout="vertical"
              />
            ) : null}
            <StatusPill>
              Información guardada en este dispositivo · Información recibida el{' '}
              {formatDate(med.obtenido_en)}
            </StatusPill>
            <VisualButton
              label="Configurar aviso"
              secondary
              onPress={() =>
                router.push({
                  pathname: '/recordatorios/editar',
                  params: { tipo: 'medicacion', medicamentoId: med.id },
                })
              }
            />
          </InfoCard>
        ))
      )}

      <BodyText>Información guardada en este dispositivo para consulta sin conexión.</BodyText>
    </Screen>
  );
}
