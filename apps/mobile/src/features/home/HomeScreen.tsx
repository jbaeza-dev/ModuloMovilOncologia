import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionCardGrid } from '../../components/ActionCard';
import { MascotHero } from '../../components/MascotAvatar';
import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import { InfoCard, SectionTitle, StatusPill, VisualButton } from '../../components/Visual';
import { useEproRepository } from '../medical-forms/use-epro-repository';
import { eproHomeDescription } from './epro-home-status';
import type { PatientProfileRecord } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useReminderStatus } from '../../hooks/use-reminder-status';
import { DEMO_PATIENTS, useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { useProfileIdentity } from '../profile/IdentityProfileScreens';
import {
  generateIntakeLogId,
  getMedicationIntakesForDate,
  logMedicationIntake,
  type MedicationIntakeLogEntry,
} from '../../data/local/medication-intake-log';
import {
  formatCivilDateDisplay,
  formatNextReminderLabel,
  getCivilPartsInTimeZone,
} from '../../services/reminders/reminder-status';
import { theme } from '../../theme';
import { isDemoMode } from '../../utils/environment';
import { consumeHomeScrollToTop, subscribeHomeScrollToTop } from './home-scroll-signal';

export function resolveHomeGreeting(options: {
  loadingProfile: boolean;
  profile: PatientProfileRecord | null;
  patientId: string | null;
  demoMode: boolean;
}): string {
  const { loadingProfile, profile, patientId, demoMode } = options;
  if (loadingProfile || !patientId) {
    return 'Hola, te damos la bienvenida';
  }

  if (profile && profile.paciente_id === patientId) {
    const trimmedName = profile.nombre.trim();
    if (trimmedName.length > 0) {
      return `Hola, ${trimmedName}`;
    }
  }

  if (demoMode) {
    const demoLabel = DEMO_PATIENTS.find((p) => p.id === patientId)?.label?.trim() ?? '';
    if (demoLabel.length > 0) {
      return `Hola, ${demoLabel}`;
    }
  }

  return 'Hola, te damos la bienvenida';
}

function formatIntakeTime(iso: string): string {
  try {
    return getCivilPartsInTimeZone(iso, 'America/Santiago').hourMinute;
  } catch {
    return '';
  }
}

export function HomeScreen() {
  const epro = useEproRepository();
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const scrollRef = useRef<ScrollView | null>(null);
  const {
    database,
    repository,
    patientId,
    manager,
    saving,
    isClosing,
    trackOperation,
    reconcileReminders,
    bumpRemindersRevision,
    notificationAdapter,
  } = useLocalData();

  const loadProfile = useCallback(
    () => (repository ? repository.profile() : Promise.resolve(null)),
    [repository],
  );
  const { value: profile, loading: loadingProfile } = useFocusedValue(
    loadProfile,
    null as PatientProfileRecord | null,
  );

  const loadDailyStatus = useCallback(() => epro?.hub() ?? Promise.resolve(null), [epro]);

  const {
    value: dailyStatus,
    loading: loadingDailyStatus,
    error: dailyStatusError,
    refresh: refreshDailyStatus,
  } = useFocusedValue(
    loadDailyStatus,
    null as Awaited<ReturnType<NonNullable<typeof epro>['hub']>> | null,
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshDailyStatus();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refreshDailyStatus]);

  const {
    loading: reminderLoading,
    evaluation,
    snapshot,
    retryingScheduling,
    refresh: refreshReminderStatus,
    retryScheduling,
  } = useReminderStatus({ tipo: 'registro_vitales' });

  const [resumingNotices, setResumingNotices] = useState(false);

  const { identity } = useProfileIdentity();
  const medications = identity?.clinicalProfile?.medicamentos;
  const isUnlinked = Boolean(identity && identity.treatmentStatus !== 'available');
  const hasActiveMeds = Boolean(medications && medications.length > 0);
  const primaryMed = hasActiveMeds ? medications![0] : null;

  const { snapshot: medReminderSnapshot } = useReminderStatus({
    tipo: 'medicacion',
    medicamentoId: primaryMed?.id ?? null,
  });

  const scheduledSlots = useMemo(() => {
    if (!primaryMed) return [];
    const hoursSet = new Set<string>();
    const activeRules =
      medReminderSnapshot?.rules.filter((r) => r.habilitado && r.medicamentoId === primaryMed.id) ??
      [];
    for (const rule of activeRules) {
      for (const hm of rule.horasMinutos) {
        if (hm && hm.trim()) hoursSet.add(hm.trim());
      }
    }
    return Array.from(hoursSet).sort();
  }, [primaryMed, medReminderSnapshot]);

  const [todayIntakes, setTodayIntakes] = useState<MedicationIntakeLogEntry[]>([]);
  const [loggingIntake, setLoggingIntake] = useState(false);

  const getTodayCivilDate = useCallback(() => {
    return getCivilPartsInTimeZone(new Date().toISOString()).civilDate;
  }, []);

  const unprogrammedToday = useMemo(() => {
    if (!primaryMed) return [];
    return todayIntakes.filter(
      (i) => i.medicamento_id === primaryMed.id && i.horario_programado.startsWith('sin_horario'),
    );
  }, [primaryMed, todayIntakes]);

  const getNextUnprogrammedSlot = useCallback(() => {
    let nextNum = unprogrammedToday.length + 1;
    let slot = `sin_horario#${nextNum}`;
    while (unprogrammedToday.some((i) => i.horario_programado === slot)) {
      nextNum++;
      slot = `sin_horario#${nextNum}`;
    }
    return slot;
  }, [unprogrammedToday]);

  const loadTodayIntakes = useCallback(async () => {
    if (!database || !patientId) return;
    try {
      const today = getTodayCivilDate();
      const rows = await getMedicationIntakesForDate(database, patientId, today);
      setTodayIntakes(rows);
    } catch {
      // Non-blocking
    }
  }, [database, patientId, getTodayCivilDate]);

  useEffect(() => {
    void loadTodayIntakes();
  }, [loadTodayIntakes]);

  const handleLogIntake = async (estado: 'taken' | 'omitted', slot?: string) => {
    if (!database || !patientId || !primaryMed || loggingIntake || isClosing) return;
    setLoggingIntake(true);
    try {
      const now = new Date();
      const todayCivil = getTodayCivilDate();
      const scheduledTime =
        slot ?? (scheduledSlots.length > 0 ? scheduledSlots[0] : getNextUnprogrammedSlot());
      const isProgramado =
        scheduledTime === 'sin_horario' || scheduledTime.startsWith('sin_horario') ? 0 : 1;
      const deterministicId = generateIntakeLogId(
        patientId,
        primaryMed.id,
        todayCivil,
        scheduledTime,
      );
      const nowIso = now.toISOString();
      const entry: MedicationIntakeLogEntry = {
        id: deterministicId,
        paciente_id: patientId,
        medicamento_id: primaryMed.id,
        medicamento_nombre: primaryMed.nombre ?? 'Medicamento',
        dosis: primaryMed.dosis ?? null,
        fecha_civil: todayCivil,
        horario_programado: scheduledTime,
        es_programado: isProgramado,
        fecha_hora: nowIso,
        estado,
        registrado_en: nowIso,
      };
      await trackOperation(async () => {
        await logMedicationIntake(database, entry);
      });
      await loadTodayIntakes();
    } finally {
      setLoggingIntake(false);
    }
  };

  const requestIntake = (estado: 'taken' | 'omitted', slot?: string) => {
    if (!patientId || !primaryMed || loggingIntake || isClosing) return;
    const owner = patientId;
    const epoch = manager?.getContextEpoch?.();
    const timeLabel =
      slot && !slot.startsWith('sin_horario')
        ? `Horario: ${slot}.`
        : 'Toma sin horario programado.';
    Alert.alert(
      'Confirma tu registro',
      `${primaryMed.nombre ?? 'Medicamento'}${primaryMed.dosis ? ` · ${primaryMed.dosis}` : ''}. ${timeLabel} Registrar como ${estado === 'taken' ? 'tomada' : 'omitida'}. Esto solo anota lo que nos indicas; no cambia tu tratamiento.`,
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Confirmar registro',
          onPress: () => {
            if (
              (manager?.getPatientId && manager.getPatientId() !== owner) ||
              manager?.getContextEpoch?.() !== epoch
            )
              return;
            return handleLogIntake(estado, slot).catch(() => {
              Alert.alert(
                'No se pudo guardar',
                'Tu registro no se confirmó. Revisa la lista antes de volver a intentarlo.',
              );
            });
          },
        },
      ],
    );
  };

  useFocusEffect(
    useCallback(() => {
      if (consumeHomeScrollToTop()) {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }
      return subscribeHomeScrollToTop(() => {
        if (consumeHomeScrollToTop()) {
          scrollRef.current?.scrollTo({ y: 0, animated: false });
        }
      });
    }, []),
  );

  const greetingText = resolveHomeGreeting({
    loadingProfile,
    profile,
    patientId,
    demoMode: isDemoMode(),
  });

  const handleResumeNotices = async () => {
    if (!repository || !patientId || resumingNotices) return;
    const targetPatientId = patientId;
    const targetEpoch = manager?.getContextEpoch?.() ?? 0;
    setResumingNotices(true);
    try {
      await trackOperation(async () => {
        if (
          (manager?.getPatientId?.() ?? patientId) !== targetPatientId ||
          (manager?.getContextEpoch?.() ?? 0) !== targetEpoch
        ) {
          return;
        }
        await repository.reminders.setPreferences(true);
        bumpRemindersRevision?.();
        if (reconcileReminders) {
          await reconcileReminders(targetPatientId);
        }
      });
      refreshReminderStatus();
    } finally {
      setResumingNotices(false);
    }
  };

  const handleRequestPermission = async () => {
    if (!notificationAdapter || !patientId || resumingNotices) return;
    const targetPatientId = patientId;
    const targetEpoch = manager?.getContextEpoch?.() ?? 0;
    setResumingNotices(true);
    try {
      await notificationAdapter.requestPermission();
      if (
        (manager?.getPatientId?.() ?? patientId) !== targetPatientId ||
        (manager?.getContextEpoch?.() ?? 0) !== targetEpoch
      ) {
        return;
      }
      if (reconcileReminders) {
        await reconcileReminders(targetPatientId);
      }
      refreshReminderStatus();
    } finally {
      setResumingNotices(false);
    }
  };

  const openEditForRule = (ruleId: string | null) => {
    if (ruleId) {
      router.push(`/recordatorios/editar?id=${encodeURIComponent(ruleId)}`);
    } else {
      router.push('/recordatorios/editar?tipo=registro_vitales');
    }
  };

  const renderReminderCardContent = () => {
    if (reminderLoading) {
      return <Text style={styles.description}>Consultando tu próximo recordatorio…</Text>;
    }

    if (evaluation.status === 'query_error') {
      return (
        <>
          <Text style={styles.description}>
            No se pudo consultar el estado de tus recordatorios.
          </Text>
          <VisualButton label="Reintentar consulta" secondary onPress={refreshReminderStatus} />
        </>
      );
    }

    if (evaluation.status === 'no_configured') {
      return (
        <>
          <Text style={styles.description}>
            Aún no tienes un horario de aviso configurado para tus mediciones.
          </Text>
          <VisualButton
            label="Configurar aviso"
            secondary
            onPress={() => router.push('/recordatorios/editar?tipo=registro_vitales')}
          />
        </>
      );
    }

    if (evaluation.status === 'rule_disabled') {
      return (
        <>
          <Text style={styles.description}>Este horario está en pausa.</Text>
          <VisualButton
            label="Activar o revisar horarios"
            secondary
            onPress={() => openEditForRule(evaluation.ruleId)}
          />
        </>
      );
    }

    if (evaluation.status === 'preferences_disabled') {
      const otherCount = evaluation.otherEnabledRulesCount;
      return (
        <>
          <Text style={styles.description}>
            {otherCount > 0
              ? `Todos tus avisos están pausados. Reanudar activará este horario y otros ${otherCount} avisos habilitados.`
              : 'Todos tus avisos están pausados.'}
          </Text>
          <VisualButton
            label={
              resumingNotices
                ? 'Reanudando avisos…'
                : otherCount > 0
                  ? 'Reanudar todos los avisos'
                  : 'Reanudar avisos'
            }
            secondary
            disabled={resumingNotices || saving || isClosing}
            onPress={() => void handleResumeNotices()}
          />
        </>
      );
    }

    if (evaluation.deviceAvailability !== 'available') {
      const isBlocked =
        evaluation.deviceAvailability === 'permission_blocked' ||
        evaluation.deviceAvailability === 'channel_blocked';
      return (
        <>
          <Text style={styles.description}>
            {isBlocked
              ? 'Android no permite mostrar notificaciones.'
              : 'Tus horarios están guardados. Activa las notificaciones para recibir avisos.'}
          </Text>
          {evaluation.deviceAvailability === 'permission_required' ? (
            <VisualButton
              label={resumingNotices ? 'Solicitando permiso…' : 'Permitir notificaciones'}
              secondary
              disabled={resumingNotices || isClosing}
              onPress={() => void handleRequestPermission()}
            />
          ) : (
            <VisualButton
              label="Abrir ajustes"
              secondary
              onPress={() => void Linking.openSettings()}
            />
          )}
        </>
      );
    }

    if (evaluation.status === 'scheduled' && evaluation.fechaPrevistaUtc) {
      const nextLabel = formatNextReminderLabel(
        evaluation.fechaPrevistaUtc,
        snapshot?.nowIso ?? new Date().toISOString(),
        evaluation.zonaHoraria ?? undefined,
      );
      return (
        <>
          <Text style={styles.nextReminderHighlight}>{nextLabel}</Text>
          <VisualButton
            label="Cambiar horario"
            secondary
            onPress={() => openEditForRule(evaluation.ruleId)}
          />
        </>
      );
    }

    if (evaluation.status === 'pending_scheduling') {
      return (
        <>
          <StatusPill>Preparando avisos</StatusPill>
          <Text style={styles.description}>Preparando tus próximos avisos…</Text>
          <VisualButton
            label="Cambiar horario"
            secondary
            onPress={() => openEditForRule(evaluation.ruleId)}
          />
        </>
      );
    }

    if (evaluation.status === 'scheduling_failed') {
      return (
        <>
          <Text style={styles.description}>No se pudo preparar este aviso.</Text>
          <VisualButton
            label={retryingScheduling ? 'Reintentando…' : 'Reintentar programación'}
            secondary
            disabled={retryingScheduling || isClosing}
            onPress={() => void retryScheduling()}
          />
        </>
      );
    }

    // evaluation.status === 'no_upcoming'
    const noUpcomingText =
      evaluation.noUpcomingReason === 'ended'
        ? `Tu pauta de avisos finalizó${evaluation.fechaFin ? ` el ${formatCivilDateDisplay(evaluation.fechaFin)}` : ''}.`
        : evaluation.noUpcomingReason === 'starts_after_window'
          ? `Tu pauta de avisos comienza${evaluation.fechaInicio ? ` el ${formatCivilDateDisplay(evaluation.fechaInicio)}` : ' más adelante'}.`
          : 'No hay avisos programados para los próximos días.';

    return (
      <>
        <Text style={styles.description}>{noUpcomingText}</Text>
        <VisualButton
          label="Cambiar horario"
          secondary
          onPress={() => openEditForRule(evaluation.ruleId)}
        />
      </>
    );
  };

  return (
    <Screen isRoot showProfile showHelp scrollRef={scrollRef}>
      <MascotHero
        pose="reposo"
        eyebrow="TU CUIDADO DE HOY"
        title={greetingText}
        description="Tus registros y cuidados diarios en este teléfono."
        compact
      />

      {isUnlinked ? (
        <InfoCard>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>Tu cuaderno ya está disponible</Text>
            <StatusPill>Tratamiento aún no vinculado</StatusPill>
          </View>
          <Text style={styles.description}>
            Vincula tu tratamiento con tu equipo de salud. Mientras tanto, puedes registrar
            mediciones y consultar guías.
          </Text>
          <VisualButton
            label="Solicitar código de vinculación"
            secondary
            onPress={() => router.push('/perfil/vinculacion')}
          />
        </InfoCard>
      ) : null}

      <View style={styles.section}>
        <SectionTitle>Para hoy</SectionTitle>
        <NavigationCard
          title="Cómo me siento hoy"
          description={
            loadingDailyStatus
              ? 'Consultando tu seguimiento…'
              : dailyStatusError
                ? 'Abre el formulario para reintentar.'
                : eproHomeDescription(dailyStatus)
          }
          icon="clipboard"
          href="/formulario"
          navigationMethod="push"
          primary
        />
        <NavigationCard
          title="Registrar signos vitales"
          description="Anota tus mediciones."
          icon="activity"
          href="/vitales/registrar"
          navigationMethod="push"
        />

        {hasActiveMeds && primaryMed ? (
          <InfoCard>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{primaryMed.nombre ?? 'Medicación de hoy'}</Text>
              <StatusPill>
                {scheduledSlots.length === 0
                  ? 'Sin horario configurado'
                  : scheduledSlots.length === 1
                    ? `Horario: ${scheduledSlots[0]}`
                    : `${scheduledSlots.length} horarios`}
              </StatusPill>
            </View>
            <Text style={styles.description}>
              {primaryMed.dosis ? `Dosis: ${primaryMed.dosis}` : ''}
              {primaryMed.dosis && primaryMed.frecuencia ? ' · ' : ''}
              {primaryMed.frecuencia ? `Frecuencia: ${primaryMed.frecuencia}` : ''}
            </Text>
            {scheduledSlots.length === 0 ? (
              <>
                <Text style={styles.helper}>Puedes añadir un aviso o registrar una toma.</Text>
                {unprogrammedToday.length === 0 ? (
                  <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
                    <View style={styles.intakeActionRow}>
                      <VisualButton
                        label={loggingIntake ? 'Guardando…' : 'Tomé una dosis (sin horario)'}
                        disabled={loggingIntake || isClosing}
                        onPress={() => requestIntake('taken', getNextUnprogrammedSlot())}
                      />
                      <VisualButton
                        label="Omitir"
                        secondary
                        disabled={loggingIntake || isClosing}
                        onPress={() => requestIntake('omitted', getNextUnprogrammedSlot())}
                      />
                    </View>
                    <VisualButton
                      label="Configurar aviso de horario"
                      secondary
                      disabled={loggingIntake || isClosing}
                      onPress={() =>
                        router.push({
                          pathname: '/recordatorios/editar',
                          params: { tipo: 'medicacion', medicamentoId: primaryMed.id },
                        })
                      }
                    />
                  </View>
                ) : (
                  <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
                    <Text style={styles.helper}>
                      {unprogrammedToday.length === 1
                        ? '1 toma sin horario registrada hoy:'
                        : `${unprogrammedToday.length} tomas sin horario registradas hoy:`}
                    </Text>
                    {unprogrammedToday.map((intake, idx) => (
                      <View key={intake.id} style={styles.slotRow}>
                        <View style={styles.slotHeader}>
                          <Text style={styles.slotTitle}>
                            Toma sin horario {idx + 1}
                            {intake.fecha_hora ? ` (${formatIntakeTime(intake.fecha_hora)})` : ''}
                          </Text>
                          <StatusPill>
                            {intake.estado === 'taken' ? 'Tomada' : 'Omitida'}
                          </StatusPill>
                        </View>
                        {intake.rectificado_en ? (
                          <Text style={styles.helper}>
                            Rectificada ({intake.estado === 'taken' ? 'tomada' : 'omitida'})
                          </Text>
                        ) : null}
                        <View style={styles.intakeActionRow}>
                          <VisualButton
                            label={
                              loggingIntake
                                ? 'Guardando…'
                                : intake.estado === 'taken'
                                  ? 'Corregir a omitida'
                                  : 'Corregir a tomada'
                            }
                            secondary
                            disabled={loggingIntake || isClosing}
                            onPress={() =>
                              requestIntake(
                                intake.estado === 'taken' ? 'omitted' : 'taken',
                                intake.horario_programado,
                              )
                            }
                          />
                        </View>
                      </View>
                    ))}
                    <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xs }}>
                      <VisualButton
                        label={loggingIntake ? 'Guardando…' : 'Registrar otra toma (sin horario)'}
                        disabled={loggingIntake || isClosing}
                        onPress={() => requestIntake('taken', getNextUnprogrammedSlot())}
                      />
                      <VisualButton
                        label="Configurar aviso de horario"
                        secondary
                        disabled={loggingIntake || isClosing}
                        onPress={() =>
                          router.push({
                            pathname: '/recordatorios/editar',
                            params: { tipo: 'medicacion', medicamentoId: primaryMed.id },
                          })
                        }
                      />
                    </View>
                  </View>
                )}
              </>
            ) : scheduledSlots.length === 1 ? (
              <>
                {todayIntakes.filter((i) => i.medicamento_id === primaryMed.id).length > 0 ? (
                  <Text style={styles.helper}>
                    {todayIntakes.find(
                      (i) => i.medicamento_id === primaryMed.id && i.estado === 'taken',
                    )
                      ? `Toma registrada hoy (${todayIntakes.filter((i) => i.medicamento_id === primaryMed.id && i.estado === 'taken').length} registro(s))`
                      : 'Dosis omitida hoy'}
                  </Text>
                ) : null}
                <View style={styles.intakeActionRow}>
                  <VisualButton
                    label={loggingIntake ? 'Guardando…' : 'Tomé mi dosis'}
                    disabled={loggingIntake || isClosing}
                    onPress={() => requestIntake('taken', scheduledSlots[0])}
                  />
                  <VisualButton
                    label="Omitir"
                    secondary
                    disabled={loggingIntake || isClosing}
                    onPress={() => requestIntake('omitted', scheduledSlots[0])}
                  />
                </View>
              </>
            ) : (
              <View style={styles.slotContainer}>
                {scheduledSlots.map((slot) => {
                  const slotIntake = todayIntakes.find(
                    (i) => i.medicamento_id === primaryMed.id && i.horario_programado === slot,
                  );
                  return (
                    <View key={slot} style={styles.slotRow}>
                      <View style={styles.slotHeader}>
                        <Text style={styles.slotTitle}>Horario programado: {slot}</Text>
                        {slotIntake ? (
                          <StatusPill>
                            {slotIntake.estado === 'taken' ? 'Tomada' : 'Omitida'}
                          </StatusPill>
                        ) : (
                          <StatusPill>Pendiente</StatusPill>
                        )}
                      </View>
                      {slotIntake?.rectificado_en ? (
                        <Text style={styles.helper}>
                          Rectificada ({slotIntake.estado === 'taken' ? 'tomada' : 'omitida'})
                        </Text>
                      ) : null}
                      <View style={styles.intakeActionRow}>
                        <VisualButton
                          label={
                            loggingIntake
                              ? 'Guardando…'
                              : slotIntake?.estado === 'taken'
                                ? 'Dosis tomada'
                                : 'Tomé mi dosis'
                          }
                          disabled={loggingIntake || isClosing}
                          onPress={() => requestIntake('taken', slot)}
                        />
                        <VisualButton
                          label={slotIntake?.estado === 'omitted' ? 'Dosis omitida' : 'Omitir'}
                          secondary
                          disabled={loggingIntake || isClosing}
                          onPress={() => requestIntake('omitted', slot)}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </InfoCard>
        ) : null}

        {identity && !hasActiveMeds && !isUnlinked ? (
          <InfoCard>
            <Text style={styles.cardTitle}>Medicamentos de tratamiento</Text>
            <Text style={styles.description}>
              Sin medicamentos registrados. Puedes anotar mediciones y responder tu formulario.
            </Text>
          </InfoCard>
        ) : null}
        <InfoCard>
          <Text style={styles.cardTitle}>Tu próxima medición</Text>
          {renderReminderCardContent()}
        </InfoCard>
      </View>
      <View style={styles.section}>
        <SectionTitle>Para acompañarte</SectionTitle>
        <ActionCardGrid>
          {[
            <NavigationCard
              key="assistant"
              title="Asistente QuimioCare"
              description="Orientación educativa"
              icon="message-circle"
              href="/asistente"
              layout="tile"
              tone="tinted"
            />,
            <NavigationCard
              key="reminders"
              title="Mis recordatorios"
              description="Horarios y tomas"
              icon="clock"
              href="/recordatorios"
              layout="tile"
            />,
          ]}
        </ActionCardGrid>
        <ActionCardGrid>
          {[
            <NavigationCard
              key="medication"
              title="Mis medicamentos"
              description="Indicaciones de tu equipo"
              icon="paperclip"
              href="/perfil/medicacion"
              layout="tile"
            />,
            <NavigationCard
              key="reports"
              title="Mis reportes"
              description="Ver y compartir"
              icon="file-text"
              href="/vitales/reportes"
              layout="tile"
            />,
          ]}
        </ActionCardGrid>
        <NavigationCard title="Bandeja de avisos" icon="bell" href="/avisos" compact />
        {__DEV__ ? (
          <NavigationCard
            title="Galería de revisión"
            description="Todas las pantallas y variantes del prototipo."
            icon="grid"
            href="/galeria"
          />
        ) : null}
      </View>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    introduction: { gap: theme.spacing.sm },
    title: { fontSize: 30, fontWeight: '700', color: colors.text },
    description: { fontSize: 16, lineHeight: 24, color: colors.secondary },
    nextReminderHighlight: { fontSize: 22, fontWeight: '700', color: colors.text },
    section: { gap: theme.spacing.md },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
    },
    cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
    helper: { fontSize: 12, lineHeight: 18, color: colors.secondary },
    intakeActionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    slotContainer: {
      marginTop: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    slotRow: {
      padding: theme.spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      gap: theme.spacing.xs,
    },
    slotHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    slotTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
  });
}
