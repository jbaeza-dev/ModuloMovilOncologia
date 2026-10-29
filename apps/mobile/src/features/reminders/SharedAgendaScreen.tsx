import { useCallback, useEffect, useState } from 'react';
import { Linking, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { GatewayRecordatorio } from '@quimiocare/contracts';
import { normalizedReminder } from '@quimiocare/contracts/agenda';
import { Screen } from '../../components/Screen';
import { BodyText, DemoBadge, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import { registerNativePush } from '../../services/session/native-session';
import type { AgendaCoverage } from '../../services/agenda/agenda-coordinator';
import type { AgendaIntent } from '../../data/agenda/agenda-repository';
import { useAppTheme } from '../../providers/ThemeProvider';
const kinds = { signos: 'Signos vitales', epro: 'Cuestionario diario', medicacion: 'Medicación' };
const days = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export function SharedAgendaScreen() {
  const {
      sharedAgenda: agenda,
      agendaCoordinator,
      reconcileReminders,
      devices,
      prepareAgenda,
      agendaBackgroundReady,
      trackOperation,
      remindersRevision = 0,
    } = useLocalData(),
    { theme } = useAppTheme();
  const [rules, setRules] = useState<GatewayRecordatorio[]>([]),
    [pending, setPending] = useState<AgendaIntent[]>([]),
    [coverage, setCoverage] = useState<AgendaCoverage | null>(null),
    [lastSync, setLastSync] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!agenda) return;
    const cached = await agenda.read();
    setRules(cached.rules);
    setLastSync(cached.state?.synchronized_at ?? null);
    setPending(await agenda.repository.intents());
    setCoverage((await agendaCoordinator?.coverage()) ?? null);
  }, [agenda, agendaCoordinator]);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load, remindersRevision]);
  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await trackOperation(work);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No pudimos actualizar los recordatorios.');
      } finally {
        await load().catch(() => undefined);
        setBusy(false);
      }
    },
    [trackOperation, load],
  );
  useFocusEffect(
    useCallback(() => {
      let current = true;
      void load()
        .then(async () => {
          try {
            await reconcileReminders();
            if (current) await load();
          } catch {
            if (current)
              setError('No se pudo actualizar la agenda. Se muestra la última copia confirmada.');
          }
        })
        .catch(() => undefined);
      return () => {
        current = false;
      };
    }, [load, reconcileReminders]),
  );
  const change = (r: GatewayRecordatorio) =>
    act(async () => {
      await agenda?.save(r.id, { ...normalizedReminder(r), activo: !r.activo }, r.version);
      await reconcileReminders();
    });
  return (
    <Screen title="Mis recordatorios">
      <DemoBadge />
      <InfoCard>
        <BodyText>
          Los cambios de horario requieren conexión y confirmación. Los avisos te recuerdan entrar a
          la aplicación; no registran una toma ni una atención médica.
        </BodyText>
        <BodyText>
          {lastSync
            ? 'Última actualización: ' + new Date(lastSync).toLocaleString('es-CL')
            : 'Aún no hay una agenda confirmada en este teléfono.'}
        </BodyText>
        <BodyText>
          {coverage?.permission
            ? `${coverage.confirmed} avisos locales programados${coverage.until ? ', hasta ' + new Date(coverage.until).toLocaleString('es-CL') : ''}.`
            : 'El respaldo local aún no está disponible. Activa las notificaciones y revisa los permisos.'}
        </BodyText>
        {!!coverage?.pendingCancellations && (
          <BodyText>
            Quedan avisos anteriores pendientes de cancelar en este teléfono. Vuelve a actualizar la
            agenda antes de confiar en el nuevo horario.
          </BodyText>
        )}
        {coverage && coverage.truncated > 0 && (
          <BodyText>
            Hay {coverage.truncated} avisos fuera de los 64 más próximos. Abre la app regularmente
            para renovar la cobertura.
          </BodyText>
        )}
        <BodyText>
          El respaldo se intenta dos minutos después del horario. Android puede retrasar o impedir
          avisos con permisos desactivados, ahorro de batería o detención forzada. La cobertura se
          renueva al abrir o conectar la app y abarca como máximo 14 días.
        </BodyText>
        {!agendaBackgroundReady && (
          <BodyText>
            El procesamiento de avisos en segundo plano no está confirmado en este teléfono.
          </BodyText>
        )}
        <VisualButton
          label={busy ? 'Actualizando…' : 'Actualizar agenda'}
          disabled={busy || !agenda}
          onPress={() => void act(() => reconcileReminders())}
        />
        <VisualButton
          label="Activar notificaciones en este teléfono"
          secondary
          disabled={busy || !devices}
          onPress={() =>
            void act(async () => {
              if (devices) await registerNativePush(devices);
              await prepareAgenda?.();
              await reconcileReminders();
            })
          }
        />
        <VisualButton
          label="Revisar permisos del teléfono"
          secondary
          onPress={() => void Linking.openSettings()}
        />
      </InfoCard>
      {error && (
        <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>
          {error}
        </Text>
      )}
      <VisualButton
        label="Crear recordatorio"
        disabled={busy || !agenda}
        onPress={() => router.push('/recordatorios/editar')}
      />
      {pending.map((intent) => (
        <InfoCard key={intent.id}>
          <SectionTitle>
            {intent.state === 'conflict' ? 'Cambio en conflicto' : 'Cambio sin confirmar'}
          </SectionTitle>
          <BodyText>
            La configuración solicitada se conserva y aún no reemplaza la agenda confirmada.
            Actualiza y revisa el horario antes de volver a editar.
          </BodyText>
          {intent.state === 'pending' && (
            <VisualButton
              label="Comprobar cambio pendiente"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await agenda?.recover(intent.id);
                  await reconcileReminders();
                })
              }
            />
          )}
          <VisualButton
            label="Descartar intención y revisar agenda"
            secondary
            disabled={busy}
            onPress={() =>
              void act(async () => {
                await agenda?.repository.discardIntent(intent.id);
                await reconcileReminders();
              })
            }
          />
        </InfoCard>
      ))}
      {!rules.length && <BodyText>No tienes horarios confirmados.</BodyText>}
      {rules.map((rule) => (
        <InfoCard key={rule.id}>
          <SectionTitle>{rule.titulo}</SectionTitle>
          <BodyText>
            {kinds[rule.tipo]} · {rule.activo ? 'Activo' : 'Pausado'}
          </BodyText>
          <BodyText>
            {rule.horas.join(', ')} · {rule.dias_semana.map((d) => days[d]).join(', ')} · hora de
            Chile (Santiago)
          </BodyText>
          <BodyText>
            Desde {rule.fecha_inicio}
            {rule.fecha_fin ? ' hasta ' + rule.fecha_fin : '. Sin fecha de término.'}
          </BodyText>
          <VisualButton
            label={'Editar ' + rule.titulo}
            secondary
            disabled={busy}
            onPress={() =>
              router.push({ pathname: '/recordatorios/editar', params: { id: rule.id } })
            }
          />
          <VisualButton
            label={rule.activo ? 'Pausar ' + rule.titulo : 'Activar ' + rule.titulo}
            secondary
            disabled={busy || pending.some((v) => v.id === rule.id)}
            onPress={() => void change(rule)}
          />
        </InfoCard>
      ))}
    </Screen>
  );
}
