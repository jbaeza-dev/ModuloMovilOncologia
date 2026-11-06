import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { GatewayRecordatorio } from '@quimiocare/contracts';
import { normalizedReminder } from '@quimiocare/contracts/agenda';
import { Screen } from '../../components/Screen';
import { DetailsDisclosure } from '../../components/DetailsDisclosure';
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
  const loadVersion = useRef(0),
    currentAgenda = useRef(agenda),
    mounted = useRef(true);
  currentAgenda.current = agenda;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadVersion.current++;
    };
  }, []);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    if (!agenda) return;
    const isCurrent = () =>
      mounted.current && currentAgenda.current === agenda && loadVersion.current === version;
    const cached = await agenda.read();
    if (!isCurrent()) return;
    agenda.assert();
    setRules(
      [...cached.rules].sort(
        (a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en) || a.id.localeCompare(b.id),
      ),
    );
    setLastSync(cached.state?.synchronized_at ?? null);
    const intents = await agenda.repository.intents();
    if (!isCurrent()) return;
    setPending(intents);
    const nextCoverage = (await agendaCoordinator?.coverage()) ?? null;
    if (!isCurrent()) return;
    setCoverage(nextCoverage);
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
    <Screen mascotPose="recordatorio" title="Mis recordatorios">
      <DemoBadge />
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>
          {error}
        </Text>
      )}
      <VisualButton
        label="Crear recordatorio"
        disabled={busy || !agenda}
        onPress={() => router.push('/recordatorios/editar')}
      />
      {!rules.length && <BodyText>No tienes horarios confirmados.</BodyText>}
      {rules.map((rule) => {
        const isPaused = !rule.activo;
        const mainTime = rule.horas.length > 0 ? rule.horas.join('  ·  ') : '--:--';
        return (
          <Pressable
            key={rule.id}
            accessibilityRole="button"
            accessibilityLabel={`Aviso ${rule.titulo}, a las ${mainTime}. ${rule.activo ? 'Activo' : 'Pausado'}. Toca para editar.`}
            onPress={() =>
              router.push({ pathname: '/recordatorios/editar', params: { id: rule.id } })
            }
            style={[
              alarmStyles.card,
              {
                backgroundColor: theme.colors.surface,
                borderColor: rule.activo ? theme.colors.primary : theme.colors.border,
                opacity: isPaused ? 0.65 : 1,
              },
            ]}
          >
            <View style={alarmStyles.topRow}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    alarmStyles.timeText,
                    { color: isPaused ? theme.colors.secondary : theme.colors.text },
                  ]}
                >
                  {mainTime}
                </Text>
                <Text style={[alarmStyles.titleText, { color: theme.colors.text }]}>
                  {rule.titulo}
                </Text>
                <Text style={[alarmStyles.typeText, { color: theme.colors.secondary }]}>
                  {kinds[rule.tipo]} · {rule.activo ? 'Activo' : 'Pausado'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  rule.activo ? `Pausar ${rule.titulo}` : `Activar ${rule.titulo}`
                }
                disabled={busy || pending.some((v) => v.id === rule.id)}
                onPress={() => void change(rule)}
              >
                <Switch
                  value={rule.activo}
                  disabled={busy || pending.some((v) => v.id === rule.id)}
                  onValueChange={() => void change(rule)}
                  trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </Pressable>
            </View>

            {/* Días activos estilo alarma */}
            <View style={alarmStyles.daysRow}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                const isActiveDay = rule.dias_semana.includes(d);
                return (
                  <View
                    key={d}
                    style={[
                      alarmStyles.dayPill,
                      {
                        backgroundColor:
                          isActiveDay && rule.activo
                            ? theme.colors.primaryContainer
                            : (theme.colors.mutedSurface ?? '#F1F5F9'),
                      },
                    ]}
                  >
                    <Text
                      style={[
                        alarmStyles.dayPillText,
                        {
                          color:
                            isActiveDay && rule.activo
                              ? theme.colors.primary
                              : theme.colors.secondary,
                          fontWeight: isActiveDay ? '700' : '500',
                        },
                      ]}
                    >
                      {days[d]}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Pressable>
        );
      })}
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
      <InfoCard>
        <BodyText>
          Necesitas internet para cambiar horarios. Los avisos no registran una toma por ti.
        </BodyText>
        <DetailsDisclosure title="Estado de los avisos">
          <BodyText>
            {lastSync
              ? 'Última actualización: ' + new Date(lastSync).toLocaleString('es-CL')
              : 'Aún no hay una agenda confirmada en este teléfono.'}
          </BodyText>
          <BodyText>
            {coverage?.permission
              ? `${coverage.confirmed} avisos programados${coverage.until ? ', hasta ' + new Date(coverage.until).toLocaleString('es-CL') : ''}.`
              : 'Activa las notificaciones para recibir avisos en este teléfono.'}
          </BodyText>
        </DetailsDisclosure>
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
          Los avisos pueden retrasarse si faltan permisos o el teléfono restringe la app. Se
          renuevan al abrir QuimioCare.
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
    </Screen>
  );
}

const alarmStyles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 10,
    marginVertical: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  timeText: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  titleText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  typeText: {
    fontSize: 13,
    marginTop: 1,
  },
  daysRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  dayPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dayPillText: {
    fontSize: 12,
  },
});
