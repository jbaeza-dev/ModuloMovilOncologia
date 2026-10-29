import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Text } from 'react-native';
import { Screen } from '../../components/Screen';
import { BodyText, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import { createLinkCodeClient, type LinkCodeState } from '../../services/session/link-code-client';
import { formatDate } from '../../data/local/repository';
import { useAppTheme } from '../../providers/ThemeProvider';

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
    <Screen title="Código de vinculación">
      <BodyText>
        Solicita el código al servidor y compártelo únicamente con tu equipo de salud.
      </BodyText>
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
              Vence el {formatDate(value.expiresAt)}. Puede consumirse antes; la copia local no
              confirma que siga disponible en el servidor.
            </BodyText>
          </>
        ) : null}
        {value?.kind === 'uncertain' && !expired ? (
          <BodyText>
            El servidor puede haber emitido un código cuya respuesta no llegó. No existe una
            consulta para recuperarlo. Para evitar solicitudes repetidas, podrás volver a intentarlo
            después del {formatDate(value.retryAfter)}.
          </BodyText>
        ) : null}
        <BodyText>
          La vigencia de un código emitido es de 24 horas. Necesitas conexión para solicitarlo; la
          copia cifrada puede consultarse sin conexión.
        </BodyText>
        {!value || value.kind === 'empty' || expired ? (
          <VisualButton
            label={busy ? 'Solicitando…' : 'Solicitar código al servidor'}
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
