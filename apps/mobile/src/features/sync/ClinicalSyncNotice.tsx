import { isRecoverableSessionPause } from '../../data/sync/session-pause';
import { useContext, useEffect, useState } from 'react';
import { BodyText, InfoCard, VisualButton } from '../../components/Visual';
import { ClinicalRevisionContext } from '../../providers/QueryRevision';
import { useOptionalLocalData } from '../../providers/LocalDataProvider';
import { KEPT_ON_PHONE } from '../../data/sync/paused-command';
import type { SyncSummary } from './sync-presentation';

/** Código del motivo guardado; vacío cuando falta o está dañado, para no confundirlo con sesión. */
const SESSION_CODE =
  "coalesce(CASE WHEN json_valid(error_json) THEN json_extract(error_json,'$.code') END,'')";

export function useClinicalSyncSummary() {
  const store = useOptionalLocalData()?.clinicalStore;
  const revision = useContext(ClinicalRevisionContext);
  const scopeKey = store ? `${store.scope.owner}|${store.scope.environment}` : '';
  const [stored, setStored] = useState<{
    key: string;
    value: SyncSummary;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setStored(null);
    if (!store) return;
    void (async () => {
      const row = await store.connection.first<{
        pending: number;
        paused: number;
        setAside: number;
        rejected: number;
        kept: number;
      }>(
        `SELECT coalesce(sum(status='pendiente'),0) pending,
          coalesce(sum(status='pausado' AND ${SESSION_CODE} IN ('SESION_EXPIRED','SESION_DENIED')),0) paused,
          coalesce(sum(status='pausado' AND ${SESSION_CODE} NOT IN ('SESION_EXPIRED','SESION_DENIED')),0) setAside,
          coalesce(sum(status='rechazado' AND ${SESSION_CODE} <> '${KEPT_ON_PHONE}'),0) rejected,
          coalesce(sum(status='rechazado' AND ${SESSION_CODE} = '${KEPT_ON_PHONE}'),0) kept
        FROM qc_clinical_command WHERE owner=? AND environment=?`,
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
    (!summary.pending &&
      !summary.paused &&
      !summary.setAside &&
      !summary.rejected &&
      !summary.runtimePaused)
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
      {summary.setAside ? (
        <BodyText>
          {summary.setAside} registro(s) no se pudieron enviar y esperan tu revisión. Los demás
          siguen enviándose.
        </BodyText>
      ) : null}
      {summary.rejected > 0 ? (
        <BodyText>
          {summary.rejected} registro(s) rechazado(s). Puedes consultar los datos conservados en el
          historial.
        </BodyText>
      ) : null}
      {error ? <BodyText>No se pudo reanudar. Revisa tu sesión y conexión.</BodyText> : null}
      {isRecoverableSessionPause(summary.pauseCode ?? null) ? (
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
