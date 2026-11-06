import { useProfileIdentity } from '../profile/IdentityProfileScreens';
import { registerNativePush } from '../../services/session/native-session';
import { MedicationDaySection } from './MedicationDaySection';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

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
import { FormsRevisionContext } from '../../providers/QueryRevision';
import { useAppTheme } from '../../providers/ThemeProvider';

import {
  formatCivilDateDisplay,
  formatNextReminderLabel,
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

export function HomeScreen() {
  const epro = useEproRepository();
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const scrollRef = useRef<ScrollView | null>(null);
  const {
    repository,
    manager,
    trackOperation,
    patientId,
    saving,
    isClosing,
    reconcileReminders,
    bumpRemindersRevision,
    notificationAdapter,
    devices,
  } = useLocalData();

  const loadProfile = useCallback(
    () => (repository ? repository.profile() : Promise.resolve(null)),
    [repository],
  );
  const { value: profile, loading: loadingProfile } = useFocusedValue(
    loadProfile,
    null as PatientProfileRecord | null,
    {
      queryKey: `${patientId ?? 'default'}:home:profile`,
    },
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
    {
      queryKey: `${patientId ?? 'default'}:home:daily-status`,
      context: FormsRevisionContext,
    },
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
  const isUnlinked = Boolean(identity && identity.treatmentStatus !== 'available');

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
        if (devices) await registerNativePush(devices).catch(() => undefined);
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
      if (devices) await registerNativePush(devices).catch(() => undefined);
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
        <NavigationCard
          title="Orientación de síntomas"
          description="Evaluación guiada de síntomas según protocolo de triaje"
          icon="help-circle"
          href="/orientacion"
          navigationMethod="push"
        />

        {snapshot?.preferences?.enabled !== false &&
        evaluation.status !== 'preferences_disabled' ? (
          <>
            <MedicationDaySection />
            <InfoCard>
              <Text style={styles.cardTitle}>Tu próxima medición</Text>
              {renderReminderCardContent()}
            </InfoCard>
          </>
        ) : null}
      </View>
      <View style={styles.section}>
        <SectionTitle>Para acompañarte</SectionTitle>
        <ActionCardGrid>
          <NavigationCard
            key="assistant"
            title="Asistente QuimioCare"
            description="Orientación educativa"
            icon="message-circle"
            href="/asistente"
            layout="tile"
            tone="tinted"
          />
          <NavigationCard
            key="reminders"
            title="Mis recordatorios"
            description="Horarios y tomas"
            icon="clock"
            href="/recordatorios"
            layout="tile"
            tone="tinted"
          />
        </ActionCardGrid>
        <ActionCardGrid>
          <NavigationCard
            key="medication"
            title="Mis medicamentos"
            description="Indicaciones de tu equipo"
            icon="paperclip"
            href="/perfil/medicacion"
            layout="tile"
          />
          <NavigationCard
            key="reports"
            title="Mis reportes"
            description="Ver y compartir"
            icon="file-text"
            href="/vitales/reportes"
            layout="tile"
          />
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
    medicationName: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.heading ?? colors.text,
      flexShrink: 1,
    },
    intakeActionRow: {
      flexDirection: 'column',
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
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
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
