import { isRecoverableSessionPause } from '../../data/sync/session-pause';
import { useContext, useEffect, useState } from 'react';
import { BodyText, InfoCard, VisualButton } from '../../components/Visual';
import { QueryRevisionContext } from '../../providers/QueryRevision';
import { useOptionalLocalData } from '../../providers/LocalDataProvider';

export function useClinicalSyncSummary() {
  const store = useOptionalLocalData()?.clinicalStore;
  const revision = useContext(QueryRevisionContext);
  const scopeKey = store ? `${store.scope.owner}|${store.scope.environment}` : '';
  const [stored, setStored] = useState<{
    key: string;
    value: {
      pending: number;
      paused: number;
      rejected: number;
      runtimePaused: boolean;
      pauseCode: string | null;
    };
  } | null>(null);
  useEffect(() => {
    let active = true;
    setStored(null);
    if (!store) return;
    void (async () => {
      const row = await store.connection.first<{
        pending: number;
        paused: number;
        rejected: number;
      }>(
        `SELECT coalesce(sum(status='pendiente'),0) pending,coalesce(sum(status='pausado'),0) paused,coalesce(sum(status='rechazado'),0) rejected FROM qc_clinical_command WHERE owner=? AND environment=?`,
        [store.scope.owner, store.scope.environment],
      );
      if (active && row)
        setStored({
          key: scopeKey,
          value: { ...row, runtimePaused: !!store.pauseCode, pauseCode: store.pauseCode },
        });
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [store, revision, scopeKey]);
  return { store, summary: stored?.key === scopeKey ? stored.value : null };
}

export function ClinicalSyncNotice() {
  const { store, summary } = useClinicalSyncSummary();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  if (
    !store ||
    !summary ||
    (!summary.pending && !summary.paused && !summary.rejected && !summary.runtimePaused)
  )
    return null;
  return (
    <InfoCard>
      {summary.pending > 0 ? (
        <BodyText>{summary.pending} registro(s) pendiente(s) de envío.</BodyText>
      ) : null}
      {summary.paused > 0 || summary.runtimePaused ? (
        <BodyText>
          Los envíos están pausados. Tus registros se conservan en este dispositivo.
        </BodyText>
      ) : null}
      {summary.rejected > 0 ? (
        <BodyText>
          {summary.rejected} registro(s) rechazado(s). Puedes consultar los datos conservados en el
          historial.
        </BodyText>
      ) : null}
      {error ? <BodyText>No se pudo reanudar. Revisa tu sesión y conexión.</BodyText> : null}
      {isRecoverableSessionPause(summary.pauseCode) ? (
        <VisualButton
          label="Reintentar envíos"
          secondary
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setError(false);
            void store
              .resume('session')
              .catch(() => setError(true))
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </InfoCard>
  );
}
