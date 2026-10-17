import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
import type {
  ConsentEventRecord,
  ConsentStatusInfo,
  TermDefinitionRecord,
} from '../../data/local/consents/consent-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

type TermWithStatus = {
  term: TermDefinitionRecord;
  status: ConsentStatusInfo;
  history: Array<ConsentEventRecord & { termino_titulo: string }>;
};

export function ConsentReviewScreen() {
  const styles = useStyles();
  const { repository, runSave, saving } = useLocalData();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadData = useCallback(async (): Promise<TermWithStatus[]> => {
    if (!repository) return [];
    const terms = await repository.listTerms();
    const result: TermWithStatus[] = [];
    for (const term of terms) {
      const status = await repository.getConsentStatus(term.termino_id, term.version);
      const history = await repository.listConsentHistory(term.termino_id, term.version);
      result.push({ term, status, history });
    }
    return result;
  }, [repository]);

  const {
    value: termsData,
    loading,
    error,
    refresh,
  } = useFocusedValue(loadData, [] as TermWithStatus[]);

  async function handleGrant(terminoId: string, version: string) {
    if (busy || saving || !repository) return;
    setBusy(true);
    setFeedback(null);
    try {
      await runSave(async () => {
        await repository.grantConsent(terminoId, version);
      });
      setFeedback('Consentimiento otorgado y guardado en este dispositivo.');
      await refresh();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Error al registrar el consentimiento.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(consentId: string) {
    if (busy || saving || !repository) return;
    setBusy(true);
    setFeedback(null);
    try {
      await runSave(async () => {
        await repository.revokeConsent(consentId);
      });
      setFeedback('Consentimiento revocado y guardado en este dispositivo.');
      await refresh();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Error al revocar el consentimiento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Consentimientos">
      <DemoBadge />
      <BodyText>
        Revisión y gestión de consentimientos informados y términos versionados de QuimioCare. Toda
        acción de aceptación o revocación se registra de manera local y queda trazada en el
        dispositivo.
      </BodyText>

      {feedback ? (
        <InfoCard>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </InfoCard>
      ) : null}

      {loading ? (
        <InfoCard>
          <BodyText>Consultando términos y consentimientos…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo consultar el registro de consentimientos.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !termsData || termsData.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="Sin términos configurados"
          description="No se encontraron términos ni consentimientos activos en el almacenamiento local."
        />
      ) : (
        termsData.map(({ term, status, history }) => (
          <InfoCard key={`${term.termino_id}-${term.version}`}>
            <SectionTitle>{term.titulo}</SectionTitle>
            <DetailRow label="Versión" value={`v${term.version}`} />
            <DetailRow label="Vigente desde" value={formatDate(term.vigente_desde)} />
            {term.vigente_hasta ? (
              <DetailRow label="Vigente hasta" value={formatDate(term.vigente_hasta)} />
            ) : null}

            <View style={styles.contentBox}>
              <Text style={styles.contentText}>{term.contenido_markdown}</Text>
            </View>

            <View style={styles.statusRow}>
              {status.estado === 'otorgado' ? (
                <>
                  <StatusPill>
                    Consentimiento otorgado el{' '}
                    {formatDate(status.activeConsent!.fecha_otorgamiento)}
                  </StatusPill>
                  <StatusPill>Guardado en este dispositivo · Pendiente de envío</StatusPill>
                  <VisualButton
                    label="Revocar consentimiento"
                    secondary
                    onPress={() => handleRevoke(status.activeConsent!.id)}
                    disabled={busy || saving}
                  />
                </>
              ) : status.estado === 'revocado' ? (
                <>
                  <StatusPill>
                    Consentimiento revocado el {formatDate(status.lastConsent!.fecha_revocacion!)}
                  </StatusPill>
                  <StatusPill>Guardado en este dispositivo · Pendiente de envío</StatusPill>
                  <VisualButton
                    label="Aceptar consentimiento nuevamente"
                    onPress={() => handleGrant(term.termino_id, term.version)}
                    disabled={busy || saving}
                  />
                </>
              ) : (
                <>
                  <StatusPill>Pendiente de aceptación</StatusPill>
                  <VisualButton
                    label="Aceptar consentimiento"
                    onPress={() => handleGrant(term.termino_id, term.version)}
                    disabled={busy || saving}
                  />
                </>
              )}
            </View>

            {history && history.length > 0 ? (
              <View style={styles.historyContainer}>
                <Text style={styles.historyTitle}>
                  Historial local de eventos ({history.length})
                </Text>
                {history.map((ev) => (
                  <View key={ev.id} style={styles.historyRow}>
                    <Text style={styles.historyText}>
                      #{ev.secuencia} · v{ev.version} ·{' '}
                      {ev.accion === 'otorgado' ? 'Otorgado' : 'Revocado'} ·{' '}
                      {formatDate(ev.fecha_evento)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </InfoCard>
        ))
      )}

      <BodyText>
        Trazabilidad local preservada sin conexión. La revocación no elimina registros clínicos
        anteriores del paciente.
      </BodyText>
    </Screen>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;
  return StyleSheet.create({
    contentBox: {
      padding: theme.spacing.sm,
      backgroundColor: appTheme.colorScheme === 'dark' ? '#1E293B' : '#F1F5F9',
      borderRadius: theme.radius.sm,
      marginVertical: theme.spacing.sm,
    },
    contentText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    statusRow: {
      gap: theme.spacing.xs,
      marginVertical: theme.spacing.sm,
    },
    feedbackText: {
      color: colors.primary,
      fontWeight: '600',
      fontSize: 14,
    },
    historyContainer: {
      marginTop: theme.spacing.md,
      paddingTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    historyTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    historyRow: {
      paddingVertical: 2,
    },
    historyText: {
      fontSize: 12,
      color: colors.secondary,
    },
  });
}
