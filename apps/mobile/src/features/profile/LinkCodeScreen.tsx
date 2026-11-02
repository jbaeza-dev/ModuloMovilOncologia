import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Text } from 'react-native';
import { Screen } from '../../components/Screen';
import { BodyText, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import { createLinkCodeClient, type LinkCodeState } from '../../services/session/link-code-client';
import { formatDate } from '../../data/local/repository';
import { useAppTheme } from '../../providers/ThemeProvider';
import { router } from 'expo-router';

export function LinkCodeScreen() {
  const { clinicalStore, identitySession, trackOperation, isClosing } = useLocalData();
  const { theme } = useAppTheme();
  const client = useMemo(
    () =>
      clinicalStore && identitySession
        ? createLinkCodeClient(clinicalStore.connection, identitySession, clinicalStore.scope.owner)
        : null,
    [clinicalStore, identitySession],
  );
  const [result, setResult] = useState<{ client: typeof client; value: LinkCodeState } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const load = useCallback(async () => {
    if (!client) return;
    try {
      const value = await client.read();
      setResult({ client, value });
      setError('');
    } catch {
      setError('No se pudo leer la copia del código.');
    }
  }, [client]);
  useEffect(() => {
    setResult(null);
    setError('');
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setClock(Date.now());
        void load();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);
  const value = result?.client === client ? result?.value : undefined;
  const boundary =
    value?.kind === 'known'
      ? value.expiresAt
      : value?.kind === 'uncertain'
        ? value.retryAfter
        : null;
  const expired = !!boundary && Date.parse(boundary) <= clock;
  async function generate() {
    if (!client || busy || isClosing) return;
    setBusy(true);
    setError('');
    try {
      const value = await trackOperation(() => client.generate());
      setResult({ client, value });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo solicitar el código.');
      // Reload the durable uncertain state even when the response did not arrive.
      try {
        setResult({ client, value: await client.read() });
      } catch {
        /* Context may have closed. */
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen mascotPose="apoyo" title="Código de vinculación">
      <BodyText>Solicita un código y muéstralo a tu equipo de salud.</BodyText>
      <InfoCard>
        <SectionTitle>
          {value?.kind === 'known'
            ? expired
              ? 'Código vencido'
              : 'Código guardado'
            : value?.kind === 'uncertain' && !expired
              ? 'Resultado de la solicitud desconocido'
              : 'Solicitar código'}
        </SectionTitle>
        {value?.kind === 'known' ? (
          <>
            <Text
              selectable
              accessibilityLabel={'Código ' + value.code}
              style={{ fontSize: 28, color: theme.colors.primary, fontWeight: '700' }}
            >
              {value.code}
            </Text>
            <BodyText>
              Vence el {formatDate(value.expiresAt)}. Tu equipo puede usarlo una sola vez.
            </BodyText>
          </>
        ) : null}
        {value?.kind === 'uncertain' && !expired ? (
          <>
            <BodyText>
              No pudimos confirmar la solicitud. Podrás pedir otro código después del{' '}
              {formatDate(value.retryAfter)}.
            </BodyText>
            <VisualButton
              label="Revisar mi vinculación"
              secondary
              onPress={() => router.push('/perfil/clinico')}
            />
          </>
        ) : null}
        <BodyText>Muéstralo a tu equipo de salud. Necesitas internet para solicitarlo.</BodyText>
        {!value || value.kind === 'empty' || expired ? (
          <VisualButton
            label={busy ? 'Solicitando…' : 'Solicitar código'}
            disabled={!client || busy || isClosing}
            onPress={() => void generate()}
          />
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>
            {error}
          </Text>
        ) : null}
      </InfoCard>
    </Screen>
  );
}
