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
import { refreshMedicalTeam } from '../../data/local/clinical-context/refresh-medical-team';

export function MedicalTeamScreen() {
  const { repository, identitySession, clinicalStore } = useLocalData();
  const load = useCallback(async () => {
    if (identitySession && clinicalStore) {
      await refreshMedicalTeam(
        identitySession,
        clinicalStore.connection,
        clinicalStore.scope.owner,
        clinicalStore.scope.localPatientId,
      ).catch(() => undefined);
    }
    const team = repository ? await repository.assignedMedicalTeam() : [];
    if (identitySession && team.length > 0 && !identitySession.getSnapshot().uploadAllowed) {
      await identitySession.refreshIdentity().catch(() => undefined);
      if (identitySession.getSnapshot().uploadAllowed) {
        await clinicalStore?.resume('session').catch(() => undefined);
      }
    }
    return team;
  }, [repository, identitySession, clinicalStore]);
  const {
    value: team,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, [] as AssignedProfessional[]);

  return (
    <Screen mascotPose="explicacion" title="Equipo tratante">
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
          <BodyText>No se pudo consultar tu equipo de salud.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !team || team.length === 0 ? (
        <EmptyState
          icon="user"
          title="Sin equipo médico vinculado"
          description="Aún no hay profesionales asociados a tu cuenta."
        />
      ) : (
        team.map((prof) => (
          <InfoCard key={prof.id}>
            <SectionTitle>{prof.nombre}</SectionTitle>
            <DetailRow label="Especialidad" value={prof.especialidad} />
            {prof.email ? <DetailRow label="Correo" value={prof.email} /> : null}
            <DetailRow label="Vinculado desde" value={formatDate(prof.fecha_vinculacion)} />
            <StatusPill>
              Equipo tratante activo · Información recibida el {formatDate(prof.obtenido_en)}
            </StatusPill>
          </InfoCard>
        ))
      )}

      <BodyText>Información guardada en este dispositivo para consulta sin conexión.</BodyText>
    </Screen>
  );
}
