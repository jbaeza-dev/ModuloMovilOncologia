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
import type { AssignedProfessional } from '../../data/local/clinical-context/clinical-context-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';

export function MedicalTeamScreen() {
  const { repository } = useLocalData();
  const load = useCallback(
    () => (repository ? repository.assignedMedicalTeam() : Promise.resolve([])),
    [repository],
  );
  const {
    value: team,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, [] as AssignedProfessional[]);

  return (
    <Screen title="Equipo tratante" backTo="/perfil">
      <DemoBadge />
      <BodyText>
        Profesionales de salud vinculados a tu atención oncológica disponibles para consulta sin
        conexión en este dispositivo.
      </BodyText>

      {loading ? (
        <InfoCard>
          <BodyText>Consultando equipo médico vinculado…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo consultar el equipo médico local.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !team || team.length === 0 ? (
        <EmptyState
          icon="user"
          title="Sin equipo médico vinculado"
          description="No se encontraron profesionales de salud vinculados activamente a este paciente en el almacenamiento local."
        />
      ) : (
        team.map((prof) => (
          <InfoCard key={prof.id}>
            <SectionTitle>{prof.nombre}</SectionTitle>
            <DetailRow label="Especialidad" value={prof.especialidad} />
            {prof.email ? <DetailRow label="Correo" value={prof.email} /> : null}
            <DetailRow label="Vinculado desde" value={formatDate(prof.fecha_vinculacion)} />
            <StatusPill>
              Equipo tratante activo · Obtenido el {formatDate(prof.obtenido_en)}
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
