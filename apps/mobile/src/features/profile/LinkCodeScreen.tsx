import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { BodyText, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import { createLinkCodeClient, type LinkCodeState } from '../../services/session/link-code-client';
import { formatDate } from '../../data/local/repository';
import type { AssignedProfessional } from '../../data/local/clinical-context/clinical-context-types';
import { useAppTheme } from '../../providers/ThemeProvider';
import { router } from 'expo-router';
import { refreshMedicalTeam } from '../../data/local/clinical-context/refresh-medical-team';

/** Sin red no se envía la solicitud; si no se puede saber, se intenta igual. */
async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

export function LinkCodeScreen() {
  const { clinicalStore, identitySession, trackOperation, isClosing, repository } = useLocalData();
  const { theme } = useAppTheme();
  const client = useMemo(
    () =>
      clinicalStore && identitySession
        ? createLinkCodeClient(
            clinicalStore.connection,
            identitySession,
            clinicalStore.scope.owner,
            Date.now,
            isOnline,
          )
        : null,
    [clinicalStore, identitySession],
  );
  const [result, setResult] = useState<{ client: typeof client; value: LinkCodeState } | null>(
    null,
  );
  const [assignedTeam, setAssignedTeam] = useState<AssignedProfessional[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const loadTeam = useCallback(async () => {
    if (!repository) return;
    try {
      if (identitySession && clinicalStore)
        await refreshMedicalTeam(
          identitySession,
          clinicalStore.connection,
          clinicalStore.scope.owner,
          clinicalStore.scope.localPatientId,
        ).catch(() => undefined);
      const team = await repository.assignedMedicalTeam();
      setAssignedTeam(team);
      if (identitySession && team.length > 0 && !identitySession.getSnapshot().uploadAllowed) {
        await identitySession.refreshIdentity().catch(() => undefined);
        if (identitySession.getSnapshot().uploadAllowed) {
          await clinicalStore?.resume('session').catch(() => undefined);
        }
      }
    } catch {
      // Ignorar fallo de lectura local
    }
  }, [repository, identitySession, clinicalStore]);

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
    void loadTeam();
  }, [load, loadTeam]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setClock(Date.now());
        void load();
        void loadTeam();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load, loadTeam]);

  const value = result?.client === client ? result?.value : undefined;
  const boundary =
    value?.kind === 'known'
      ? value.expiresAt
      : value?.kind === 'uncertain'
        ? value.retryAfter
        : null;
  const expired = !!boundary && Date.parse(boundary) <= clock;
  const isLinked = assignedTeam.length > 0;

  async function generate() {
    if (!client || busy || isClosing) return;
    setBusy(true);
    setError('');
    try {
      const value = await trackOperation(() => client.generate());
      setResult({ client, value });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo solicitar el código.');
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
      {isLinked ? (
        <InfoCard>
          <SectionTitle>Tu cuenta está vinculada</SectionTitle>
          <BodyText>
            Tu cuenta está vinculada con tu equipo de salud ({assignedTeam.length}{' '}
            {assignedTeam.length === 1 ? 'profesional asignado' : 'profesionales asignados'}).
          </BodyText>
          <View style={{ marginTop: 8 }}>
            <VisualButton
              label="Ver mi equipo de salud"
              secondary
              onPress={() => router.push('/perfil/equipo')}
            />
          </View>
        </InfoCard>
      ) : null}

      <BodyText>
        {isLinked
          ? 'Si necesitas vincular a un nuevo profesional o centro, puedes solicitar un nuevo código.'
          : 'Solicita un código y muéstralo a tu equipo de salud para vincular tu atención.'}
      </BodyText>

      <InfoCard>
        <SectionTitle>
          {value?.kind === 'known'
            ? expired
              ? 'Código vencido'
              : 'Código vigente'
            : value?.kind === 'uncertain' && !expired
              ? 'Comprobando vinculación'
              : 'Solicitar código'}
        </SectionTitle>

        {value?.kind === 'known' && !expired ? (
          <>
            <Text
              selectable
              accessibilityLabel={'Código ' + value.code}
              style={{
                fontSize: 28,
                color: theme.colors.primary,
                fontWeight: '700',
                letterSpacing: 2,
              }}
            >
              {value.code}
            </Text>
            <BodyText>
              Vence el {formatDate(value.expiresAt)}. Tu equipo de salud puede usarlo una sola vez.
            </BodyText>
          </>
        ) : null}

        {value?.kind === 'known' && expired ? (
          <BodyText>
            El código generado anteriormente venció el {formatDate(value.expiresAt)}. Puedes
            solicitar uno nuevo.
          </BodyText>
        ) : null}

        {value?.kind === 'uncertain' && !expired ? (
          <>
            <BodyText>
              {value.conflict
                ? `Ya existe un código vigente, pero no alcanzó a llegar a este teléfono. Si se lo entregaste a tu equipo de salud, pueden seguir usándolo. Si no, podrás solicitar uno nuevo cuando venza, a más tardar el ${formatDate(value.retryAfter)}.`
                : 'No recibimos la respuesta del servidor a tu solicitud. Puedes intentar de nuevo: si el código ya se había creado, no se generará uno duplicado.'}
            </BodyText>
            <VisualButton
              label={busy ? 'Solicitando…' : 'Intentar de nuevo'}
              disabled={!client || busy || isClosing}
              onPress={() => void generate()}
            />
            <View style={{ marginTop: 8 }}>
              <VisualButton
                label="Revisar mi equipo de salud"
                secondary
                onPress={() => router.push('/perfil/equipo')}
              />
            </View>
          </>
        ) : null}

        <BodyText>Necesitas conexión a internet para generar un nuevo código.</BodyText>

        {!value || value.kind === 'empty' || expired ? (
          <VisualButton
            label={busy ? 'Solicitando…' : isLinked ? 'Solicitar nuevo código' : 'Solicitar código'}
            disabled={!client || busy || isClosing}
            onPress={() => void generate()}
          />
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.error, marginTop: 4 }}>
            {error}
          </Text>
        ) : null}
      </InfoCard>
    </Screen>
  );
}
