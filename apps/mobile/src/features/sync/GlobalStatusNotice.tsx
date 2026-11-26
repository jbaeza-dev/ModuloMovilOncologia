import { useContext, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import {
  keepSetAsideOnPhone,
  listSetAside,
  retrySetAside,
  type SetAsideRecord,
} from '../../data/sync/paused-command';
import { useOptionalLocalData } from '../../providers/LocalDataProvider';
import { ClinicalRevisionContext } from '../../providers/QueryRevision';
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
  const shown = model ? model.title + '|' + model.message : null;
  // Un fallo anterior deja de ser cierto en cuanto cambia el estado (por ejemplo, al reconectar).
  useEffect(() => setError(null), [shown]);
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
const KIND_LABEL: Record<SetAsideRecord['kind'], string> = {
  signos: 'Signos vitales',
  epro: 'Seguimiento diario',
};
const capturedFormat = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** Registros apartados por un error técnico, con las dos decisiones que puede tomar el paciente. */
export function SetAsideRecords() {
  const local = useOptionalLocalData();
  const store = local?.clinicalStore;
  const revision = useContext(ClinicalRevisionContext);
  const [records, setRecords] = useState<SetAsideRecord[]>([]);
  const [confirming, setConfirming] = useState<{ id: string; action: 'retry' | 'keep' } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!store) {
      setRecords([]);
      return;
    }
    void listSetAside(store.connection, store.scope)
      .then((value) => {
        if (active) setRecords(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [store, revision]);
  if (!store || records.length === 0) return null;
  async function confirm() {
    if (!store || !confirming || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (confirming.action === 'retry') {
        await retrySetAside(store.connection, store.scope, confirming.id);
        void store.triggerPendingUpload?.().catch(() => undefined);
      } else await keepSetAsideOnPhone(store.connection, store.scope, confirming.id);
      setRecords((items) => items.filter((item) => item.id !== confirming.id));
      setConfirming(null);
    } catch {
      setError('No se pudo completar la acción. El registro sigue guardado en este teléfono.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <InfoCard testID="set-aside-records">
      <SectionTitle>Registros sin enviar</SectionTitle>
      <BodyText>
        Estos registros no se pudieron enviar por un problema técnico. Siguen guardados en este
        teléfono y no detienen el envío de los demás.
      </BodyText>
      {records.map((record) => {
        const label = `${KIND_LABEL[record.kind]} del ${capturedFormat.format(new Date(record.capturedAt))}`;
        const pending = confirming?.id === record.id ? confirming.action : null;
        return (
          <View key={record.id} style={{ gap: 8 }} testID={'set-aside-' + record.id}>
            <BodyText>{label}</BodyText>
            {pending ? (
              <>
                <BodyText>
                  {pending === 'retry'
                    ? 'Se intentará enviar de nuevo este registro. Si ya había llegado, no se duplicará.'
                    : 'Este registro quedará solo en este teléfono y no se enviará a tu equipo de salud. Seguirá visible en tu historial.'}
                </BodyText>
                <VisualButton
                  label={
                    busy
                      ? 'Guardando…'
                      : pending === 'retry'
                        ? 'Sí, reintentar el envío'
                        : 'Sí, conservar solo en este teléfono'
                  }
                  disabled={busy}
                  accessibilityLabel={
                    (pending === 'retry'
                      ? 'Confirmar reintento de '
                      : 'Confirmar conservar solo en este teléfono ') + label
                  }
                  onPress={() => {
                    void confirm();
                  }}
                />
                <VisualButton
                  label="Cancelar"
                  secondary
                  disabled={busy}
                  onPress={() => setConfirming(null)}
                />
              </>
            ) : (
              <>
                <VisualButton
                  label="Reintentar el envío"
                  secondary
                  accessibilityLabel={'Reintentar el envío de ' + label}
                  onPress={() => {
                    setError(null);
                    setConfirming({ id: record.id, action: 'retry' });
                  }}
                />
                <VisualButton
                  label="Conservar solo en este teléfono"
                  secondary
                  accessibilityLabel={'Conservar solo en este teléfono ' + label}
                  onPress={() => {
                    setError(null);
                    setConfirming({ id: record.id, action: 'keep' });
                  }}
                />
              </>
            )}
          </View>
        );
      })}
      {error ? <BodyText>{error}</BodyText> : null}
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
      <SetAsideRecords />
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
