import { useState } from 'react';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { BodyText, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { useIdentity } from '../access/SessionScreens';
import { useClinicalSyncSummary } from './ClinicalSyncNotice';
import { syncPresentation } from './sync-presentation';

/** Estado integrado en Inicio; no ocupa espacio fijo sobre las otras pantallas. */
export function RecordsStatusCard({ details = false }: { details?: boolean }) {
  const { snapshot, data, session } = useIdentity();
  const { summary } = useClinicalSyncSummary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = syncPresentation(snapshot, summary);
  if (!model) return null;
  async function act() {
    if (!model || busy) return;
    setError(null);
    switch (model.action) {
      case 'consent':
        router.push('/perfil/consentimientos');
        return;
      case 'profile':
        router.push('/perfil/completar');
        return;
      case 'link':
        router.push('/perfil/vinculacion');
        return;
      case 'details':
        router.push('/perfil/estado-envios');
        return;
      case 'login':
        if (session?.config.mode === 'demo') {
          router.push('/acceso/seleccionar-paciente');
          return;
        }
        if (!data?.manager) {
          router.push('/acceso');
          return;
        }
        break;
      case 'retry':
        if (!session) return;
        break;
    }
    setBusy(true);
    try {
      if (model.action === 'login') await data?.manager.authenticate();
      else await session?.refreshIdentity();
    } catch {
      setError(
        model.action === 'login'
          ? 'No se completó el ingreso. Puedes intentarlo otra vez; tus registros siguen guardados.'
          : 'No pudimos completar la conexión. Tus registros siguen guardados y la app volverá a intentarlo cuando sea posible.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <InfoCard testID="records-status-card">
      <SectionTitle>{model.title}</SectionTitle>
      <BodyText>{model.message}</BodyText>
      {error ? <BodyText>{error}</BodyText> : null}
      {!(details && model.action === 'details') ? (
        <VisualButton
          label={busy ? 'Comprobando…' : model.label}
          secondary
          disabled={busy}
          onPress={() => {
            void act();
          }}
        />
      ) : null}
    </InfoCard>
  );
}
export function SyncStatusScreen() {
  return (
    <Screen mascotPose="resumen" title="Mis registros y envíos">
      <BodyText>
        Lo que guardas se conserva en este teléfono. La app comprueba la conexión y los permisos
        automáticamente.
      </BodyText>
      <RecordsStatusCard details />
      <VisualButton
        label="Consultar historial de signos"
        secondary
        onPress={() => router.push('/vitales')}
      />
      <VisualButton
        label="Consultar seguimientos"
        secondary
        onPress={() => router.push('/formulario')}
      />
      <VisualButton
        label="Consultar mi consentimiento"
        secondary
        onPress={() => router.push('/perfil/consentimientos')}
      />
    </Screen>
  );
}
