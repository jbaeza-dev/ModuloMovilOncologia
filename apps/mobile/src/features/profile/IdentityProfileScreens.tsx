import { readableTreatmentText } from './treatment-labels';
import { router } from 'expo-router';
import type { ClinicalMedicamentoResponse } from '@quimiocare/contracts';
import { cacheMedicationForReminder } from '../../data/local/clinical-context/medication-cache';
import { formatCivilDateDisplay } from '../../services/reminders/reminder-status';
import { useState, useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { Screen } from '../../components/Screen';
import { MascotHero } from '../../components/MascotAvatar';
import { DetailsDisclosure } from '../../components/DetailsDisclosure';
import { NavigationCard } from '../../components/NavigationCard';
import { ConfirmLogoutButton } from '../../components/ConfirmLogoutButton';
import { BodyText, DetailRow, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import type { SessionSnapshot } from '../../services/session/http-session-types';
import { formatDate } from '../../data/local/repository';

const empty: SessionSnapshot = {
  state: 'unconfigured',
  user: null,
  identity: null,
  stale: true,
  consent: null,
  terms: null,
  uploadAllowed: false,
  message: null,
  revision: 0,
};
const subscribeEmpty = () => () => undefined;
const getEmpty = () => empty;
export function useProfileIdentity() {
  const { identitySession: session, clinicalStore, trackOperation, isClosing } = useLocalData();
  const snapshot = useSyncExternalStore(
    session?.subscribe ?? subscribeEmpty,
    session?.getSnapshot ?? getEmpty,
    getEmpty,
  );
  const identity =
    snapshot.identity?.owner === session?.getCurrentUser()?.id &&
    (!clinicalStore || clinicalStore.scope.owner === snapshot.identity?.owner)
      ? snapshot.identity
      : null;
  return { session, snapshot, identity, trackOperation, isClosing };
}
function SourceNotice({ section }: { section?: 'clinical' | 'treatment' }) {
  const { identity, snapshot, session, trackOperation, isClosing } = useProfileIdentity();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const status =
    section === 'clinical'
      ? identity?.clinicalStatus
      : section === 'treatment'
        ? identity?.treatmentStatus
        : undefined;
  async function refresh() {
    if (!session || busy || isClosing) return;
    setBusy(true);
    setError('');
    try {
      await trackOperation(() => session.refreshIdentity());
    } catch {
      setError('No se pudo actualizar. La información guardada se conserva.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <InfoCard>
      <BodyText>
        {!identity
          ? 'Información no disponible.'
          : status === 'missing'
            ? 'Aún no hay información registrada.'
            : snapshot.stale || status === 'unavailable'
              ? 'Mostramos tu última información guardada.'
              : 'Información actualizada.'}
      </BodyText>
      <DetailsDisclosure title="Estado de mi información">
        {identity ? <BodyText>Última consulta: {formatDate(identity.fetchedAt)}.</BodyText> : null}
        <BodyText>
          {snapshot.uploadAllowed
            ? 'Los envíos están habilitados.'
            : 'Los envíos están pausados. Tus registros están guardados en este teléfono.'}
          {snapshot.terms ? ` Términos consultados: versión ${snapshot.terms.version}.` : ''}
        </BodyText>
      </DetailsDisclosure>
      <NavigationCard
        title="Revisar términos y sesión"
        icon="shield"
        href="/perfil/sesion"
        compact
      />
      <VisualButton
        label={busy ? 'Actualizando…' : 'Actualizar información'}
        secondary
        disabled={!session || busy || isClosing}
        onPress={() => void refresh()}
      />
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </InfoCard>
  );
}
function PersonalFields() {
  const { identity } = useProfileIdentity();
  const profile = identity?.profile;
  return profile ? (
    <InfoCard>
      <DetailRow label="Nombre" value={profile.nombre ?? 'Sin registro'} />
      <DetailRow label="RUT" value={profile.rut ?? 'Sin registro'} />
      <DetailRow label="Correo" value={profile.email} />
      <DetailRow label="Teléfono" value={profile.telefono ?? 'Sin registro'} />
      <DetailRow label="Fecha de nacimiento" value={profile.fecha_nacimiento ?? 'Sin registro'} />
    </InfoCard>
  ) : null;
}
export function ProfileScreen() {
  return (
    <Screen>
      <MascotHero pose="reposo" title="Mi perfil" eyebrow="TU CUENTA" compact />
      <PersonalFields />
      <NavigationCard title="Actualizar mis datos" icon="edit-2" href="/perfil/completar" compact />
      <NavigationCard
        title="Mis registros y envíos"
        description="Consulta lo guardado y lo pendiente de enviar"
        icon="check-circle"
        href="/perfil/estado-envios"
        compact
      />
      <NavigationCard
        title="Tratamiento, equipo y medicamentos"
        description="Tu información de salud"
        icon="users"
        href="/perfil/clinico"
      />
      <NavigationCard
        title="Código de vinculación"
        description="Vincula tu cuenta con tu centro de salud"
        icon="link-2"
        href="/perfil/vinculacion"
      />
      <NavigationCard
        title="Apariencia, sesión y teléfonos"
        description="Colores, avisos y privacidad"
        icon="settings"
        href="/perfil/preferencias"
      />
      <ConfirmLogoutButton />
    </Screen>
  );
}
export function PersonalDataScreen() {
  return (
    <Screen mascotPose="resumen" title="Datos personales">
      <PersonalFields />
      <SourceNotice />
    </Screen>
  );
}
export function ClinicalProfileScreen() {
  const { identity } = useProfileIdentity(),
    treatment = identity?.treatment,
    clinical = identity?.clinicalProfile;
  return (
    <Screen mascotPose="reposo" title="Perfil clínico">
      <SectionTitle>Tratamiento</SectionTitle>
      <SourceNotice section="treatment" />
      {treatment ? (
        <InfoCard>
          <DetailRow
            label="Tratamiento"
            value={readableTreatmentText(treatment.tipo_tratamiento_nombre)}
          />
          <DetailRow
            label="Estado"
            value={readableTreatmentText(treatment.estado ?? 'Sin registro')}
          />
          <DetailRow label="Fase" value={readableTreatmentText(treatment.fase ?? 'Sin registro')} />
          <DetailRow
            label="Intención"
            value={readableTreatmentText(treatment.intencion ?? 'Sin registro')}
          />
          <DetailRow label="Inicio" value={treatment.fecha_inicio_tratamiento ?? 'Sin fecha'} />
          <DetailRow
            label="Término"
            value={treatment.fecha_termino_tratamiento ?? 'Sin fecha informada'}
          />
          {Object.entries(treatment.parametros ?? {}).map(([name, value]) =>
            typeof value === 'string' || typeof value === 'number' ? (
              <DetailRow
                key={name}
                label={readableTreatmentText(name)}
                value={readableTreatmentText(String(value))}
                layout="vertical"
              />
            ) : null,
          )}
        </InfoCard>
      ) : null}
      <SectionTitle>Perfil clínico</SectionTitle>
      <SourceNotice section="clinical" />
      {clinical ? (
        <InfoCard>
          <DetailRow
            label="Última actualización clínica"
            value={formatDate(clinical.fecha_actualizacion)}
          />
          <DetailRow label="Grupo sanguíneo" value={clinical.grupo_sanguineo ?? 'Sin registro'} />
          <DetailRow
            label="Peso"
            value={clinical.peso == null ? 'Sin registro' : `${clinical.peso} kg`}
          />
          <DetailRow
            label="Altura"
            value={clinical.altura == null ? 'Sin registro' : `${clinical.altura} cm`}
          />
        </InfoCard>
      ) : null}
      <NavigationCard title="Mis medicamentos" icon="paperclip" href="/perfil/medicacion" />
      <NavigationCard title="Mi equipo de salud" icon="users" href="/perfil/equipo" />
    </Screen>
  );
}
export function MedicationScreen() {
  const { identity, session, trackOperation, isClosing } = useProfileIdentity(),
    clinical = identity?.clinicalProfile;
  const { database, patientId } = useLocalData();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function configure(med: ClinicalMedicamentoResponse) {
    if (!identity || !session || !database || !patientId || busy || isClosing) return;
    const signal = session.getContextSignal(),
      owner = identity.owner;
    const assertContext = () => {
      if (signal.aborted || session.getCurrentUser()?.id !== owner)
        throw new Error('La cuenta cambió.');
    };
    setBusy(true);
    setError('');
    try {
      await trackOperation(() =>
        cacheMedicationForReminder(database, patientId, identity, med.id, assertContext),
      );
      assertContext();
      router.push({
        pathname: '/recordatorios/editar',
        params: { tipo: 'medicacion', medicamentoId: med.id },
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo preparar el aviso.');
    } finally {
      setBusy(false);
    }
  }
  const medications = clinical?.medicamentos;
  return (
    <Screen mascotPose="recordatorio" title="Mis medicamentos">
      <SourceNotice section="clinical" />
      <BodyText>
        Consulta la indicación recibida. No cambies ni suspendas medicamentos sin indicación de tu
        equipo de salud.
      </BodyText>
      {clinical && !medications ? (
        <BodyText>El servicio no informó la lista de medicamentos.</BodyText>
      ) : null}
      {medications?.length === 0 ? (
        <BodyText>El servicio informó una lista de medicamentos vacía.</BodyText>
      ) : null}
      {medications?.map((med) => (
        <InfoCard key={med.id}>
          <SectionTitle>{med.nombre ?? 'Nombre no informado'}</SectionTitle>
          <DetailRow
            label="Dosis"
            value={med.dosis ?? 'No informada por el servicio'}
            layout="vertical"
          />
          <DetailRow
            label="Frecuencia"
            value={med.frecuencia ?? 'No informada por el servicio'}
            layout="vertical"
          />
          <DetailRow
            label="Estado"
            value={
              med.activo === true ? 'Activo' : med.activo === false ? 'Inactivo' : 'No informado'
            }
          />
          {med.fecha_inicio ? (
            <DetailRow label="Fecha de inicio" value={formatCivilDateDisplay(med.fecha_inicio)} />
          ) : null}
          {med.fecha_termino ? (
            <DetailRow label="Fecha de término" value={formatCivilDateDisplay(med.fecha_termino)} />
          ) : null}
          {med.motivo ? <DetailRow label="Motivo" value={med.motivo} layout="vertical" /> : null}
          {med.activo === true && med.nombre && med.dosis && med.frecuencia ? (
            <VisualButton
              label="Configurar aviso"
              secondary
              disabled={busy || isClosing}
              onPress={() => void configure(med)}
            />
          ) : null}
        </InfoCard>
      ))}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <NavigationCard title="Mis recordatorios" icon="clock" href="/recordatorios" compact />
    </Screen>
  );
}
