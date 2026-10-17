import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import type { ReminderRule } from '../../data/local/reminders/reminder-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedList, useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { ExpoNotificationAdapter } from '../../services/notifications/expo-notification-adapter';
import type { NotificationPermissionState } from '../../services/notifications/notification-adapter';
import type { CoordinatorResult } from '../../services/reminders/notification-coordinator';
import { theme } from '../../theme';

const DAYS_MAP: Record<number, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
};

function getStatusCoverageText(res: CoordinatorResult | null): string {
  if (!res) return 'Reconciliando...';
  if (res.status === 'programada') {
    if (res.programadasConfirmadas < res.totalDeseadas) {
      return `Parcial: ${res.programadasConfirmadas} de ${res.totalDeseadas} confirmadas`;
    }
    return `${res.programadasConfirmadas} confirmadas`;
  }
  if (res.status === 'programacion_pendiente') {
    if (res.motivoPendiente === 'contexto_anterior') {
      return 'Pausada (resolviendo contexto anterior)';
    }
    if (res.motivoPendiente === 'cancelacion_regla_previa') {
      return 'Pausada (limpiando versión anterior)';
    }
    return `Parcial: ${res.programadasConfirmadas} de ${res.totalDeseadas} confirmadas`;
  }
  if (res.status === 'error') {
    return 'Error de coordinación';
  }
  return 'Reconciliando...';
}

export function RemindersListScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const { database, repository, patientId, reconcileReminders, trackOperation } = useLocalData();
  const adapter = useMemo(() => new ExpoNotificationAdapter(), []);

  const [toggling, setToggling] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermissionState | null>(null);
  const [coordinatorResult, setCoordinatorResult] = useState<CoordinatorResult | null>(null);

  // Cargar preferencias del paciente
  const loadPreferences = useCallback(async () => {
    if (!repository) return { enabled: false, updatedAt: null };
    return repository.reminders.getPreferences();
  }, [repository]);

  const { value: prefs, refresh: refreshPrefs } = useFocusedValue(loadPreferences, {
    enabled: false,
    updatedAt: null,
  });

  // Cargar lista de reglas activas
  const loadRules = useCallback(async () => {
    if (!repository) return [];
    return repository.reminders.listRules();
  }, [repository]);

  const {
    items: rules,
    loading: loadingRules,
    refresh: refreshRules,
  } = useFocusedList<ReminderRule>(loadRules);

  // Consultar permisos y reconciliar agenda
  const checkAndReconcile = useCallback(async () => {
    if (!database || !patientId) return;
    try {
      const perms = await adapter.getPermissionState();
      setPermissionState(perms);

      const result = await reconcileReminders(patientId);
      if (result) {
        setCoordinatorResult(result);
      }
    } catch {
      // Reconciliación silente para no bloquear interfaz
    }
  }, [adapter, database, patientId, reconcileReminders]);

  useFocusEffect(
    useCallback(() => {
      void checkAndReconcile();
    }, [checkAndReconcile]),
  );

  // Alternar switch maestro de recordatorios
  const handleToggleMaster = async () => {
    if (!repository || !database || !patientId || toggling) return;
    setToggling(true);
    try {
      await trackOperation(async () => {
        const nextState = !prefs.enabled;

        if (nextState) {
          // Solicitar permisos al SO si se va a activar
          const reqPerms = await adapter.requestPermission();
          setPermissionState(reqPerms);

          if (reqPerms.status !== 'granted') {
            await repository.reminders.setPreferences(false);
            await refreshPrefs();
            await checkAndReconcile();
            return;
          }
        }

        await repository.reminders.setPreferences(nextState);
        await refreshPrefs();
        await checkAndReconcile();
        await refreshRules();
      });
    } finally {
      setToggling(false);
    }
  };

  // Alternar activación de una regla individual
  const handleToggleRule = async (rule: ReminderRule) => {
    if (!repository || !database || !patientId) return;
    await trackOperation(async () => {
      await repository.reminders.saveRule({
        id: rule.id,
        tipo: rule.tipo,
        medicamentoId: rule.medicamentoId,
        diasSemana: rule.diasSemana,
        horasMinutos: rule.horasMinutos,
        zonaHoraria: rule.zonaHoraria,
        fechaInicio: rule.fechaInicio,
        fechaFin: rule.fechaFin,
        habilitado: !rule.habilitado,
      });
      await checkAndReconcile();
    });
    await refreshRules();
  };

  const isBlockedInSettings = permissionState?.status === 'denied' && !permissionState?.canAskAgain;
  const isChannelBlocked = permissionState?.channelStatus === 'blocked';

  return (
    <Screen title="Recordatorios y avisos">
      <DemoBadge />

      {/* Switch Maestro */}
      <InfoCard>
        <SectionTitle>Recordatorios locales</SectionTitle>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Activar recordatorios locales"
          accessibilityState={{ checked: prefs.enabled, disabled: toggling }}
          onPress={handleToggleMaster}
          style={styles.disclosure}
          disabled={toggling}
        >
          <View style={{ flex: 1, paddingRight: theme.spacing.sm }}>
            <Text style={styles.heading}>Activar recordatorios</Text>
            <BodyText>
              {prefs.enabled
                ? 'Los avisos se programan de forma local en este dispositivo.'
                : 'Avisos desactivados. Tus registros offline permanecen disponibles.'}
            </BodyText>
          </View>
          <Feather
            name={prefs.enabled ? 'toggle-right' : 'toggle-left'}
            size={36}
            color={prefs.enabled ? appTheme.colors.primary : appTheme.colors.secondary}
          />
        </Pressable>
      </InfoCard>

      {/* Banner de permiso bloqueado en el sistema o canal */}
      {isBlockedInSettings || isChannelBlocked ? (
        <InfoCard>
          <View style={styles.alertHeader}>
            <Feather name="alert-triangle" size={24} color="#dc2626" />
            <Text style={[styles.heading, { color: '#dc2626' }]}>
              {isChannelBlocked ? 'Canal de notificaciones bloqueado' : 'Permiso bloqueado'}
            </Text>
          </View>
          <BodyText>
            {isChannelBlocked
              ? 'El canal de avisos de QuimioCare ha sido bloqueado en los Ajustes de Android. Para recibir avisos, debes habilitar el canal de recordatorios.'
              : 'Las notificaciones están bloqueadas en los Ajustes del sistema operativo. Para recibir avisos, debes habilitarlas manualmente en Android.'}
          </BodyText>
          <VisualButton
            label="Abrir Ajustes de Android"
            secondary
            onPress={() => {
              void Linking.openSettings();
            }}
          />
        </InfoCard>
      ) : null}

      {/* Incidencias de coordinación / errores */}
      {coordinatorResult &&
      (coordinatorResult.status === 'error' || coordinatorResult.incidencias.length > 0) ? (
        <InfoCard>
          <View style={styles.alertHeader}>
            <Feather name="alert-circle" size={24} color="#dc2626" />
            <Text style={[styles.heading, { color: '#dc2626' }]}>Incidencias en la agenda</Text>
          </View>
          {coordinatorResult.incidencias.map((inc, idx) => (
            <BodyText key={idx} style={{ color: '#dc2626', fontSize: 13 }}>
              • {inc}
            </BodyText>
          ))}
          <VisualButton
            label="Reintentar reconciliación"
            secondary
            onPress={() => {
              void checkAndReconcile();
            }}
          />
        </InfoCard>
      ) : null}

      {/* Estado y Cobertura de la Agenda */}
      {prefs.enabled && permissionState?.status === 'granted' && !isChannelBlocked ? (
        <InfoCard>
          <SectionTitle>Estado de la agenda</SectionTitle>
          <View style={styles.row}>
            <Text style={styles.subheading}>Cobertura efectiva:</Text>
            <StatusPill>{getStatusCoverageText(coordinatorResult)}</StatusPill>
          </View>

          {coordinatorResult?.cubiertoHastaIso ? (
            <BodyText>
              Programados hasta:{' '}
              <Text style={{ fontWeight: '700' }}>
                {formatDate(coordinatorResult.cubiertoHastaIso)}
              </Text>{' '}
              (ventana móvil de 14 días).
            </BodyText>
          ) : null}

          {coordinatorResult && coordinatorResult.truncadas > 0 ? (
            <View style={styles.warningBox}>
              <Feather name="info" size={20} color="#b45309" />
              <BodyText>
                Límite de 128 trabajos alcanzado. {coordinatorResult.truncadas} ocurrencias
                posteriores fueron truncadas. Puedes ajustar horarios para mayor cobertura en días.
              </BodyText>
            </View>
          ) : null}

          <BodyText style={{ fontSize: 13, color: appTheme.colors.secondary }}>
            La ventana de 14 días se renueva al abrir QuimioCare. Si la aplicación no se abre, los
            avisos cesarán al cumplirse las fechas programadas.
          </BodyText>
        </InfoCard>
      ) : null}

      {/* Reglas Configuradas */}
      <View style={styles.sectionHeader}>
        <SectionTitle>Tus reglas de recordatorio</SectionTitle>
        <VisualButton
          label="Crear recordatorio"
          onPress={() => router.push('/recordatorios/editar')}
        />
      </View>

      {loadingRules ? (
        <InfoCard>
          <BodyText>Cargando recordatorios...</BodyText>
        </InfoCard>
      ) : rules.length === 0 ? (
        <EmptyState
          icon="clock"
          title="Sin recordatorios configurados"
          description="Crea recordatorios para el registro de signos vitales o la consulta de medicamentos."
        />
      ) : (
        rules.map((rule) => {
          const daysText = rule.diasSemana.map((d) => DAYS_MAP[d] ?? d).join(', ');
          const hoursText = rule.horasMinutos.join(', ');

          return (
            <InfoCard key={rule.id}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ruleTitle}>
                    {rule.tipo === 'registro_vitales'
                      ? 'Registro de signos vitales'
                      : 'Consulta de medicación'}
                  </Text>
                  <Text style={styles.ruleSubtitle}>
                    Días: {daysText} · Horas: {hoursText}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={`Activar ${rule.tipo}`}
                  accessibilityState={{ checked: rule.habilitado }}
                  onPress={() => handleToggleRule(rule)}
                  style={{ padding: theme.spacing.xs }}
                >
                  <Feather
                    name={rule.habilitado ? 'check-circle' : 'circle'}
                    size={28}
                    color={rule.habilitado ? appTheme.colors.primary : appTheme.colors.secondary}
                  />
                </Pressable>
              </View>

              <View style={styles.ruleActions}>
                <VisualButton
                  label="Editar"
                  secondary
                  onPress={() =>
                    router.push({ pathname: '/recordatorios/editar', params: { id: rule.id } })
                  }
                />
              </View>
            </InfoCard>
          );
        })
      )}

      {/* Acceso a la Bandeja de Avisos */}
      <InfoCard>
        <SectionTitle>Historial de avisos</SectionTitle>
        <BodyText>
          Revisa las observaciones de entrega y el historial de avisos registrados en este teléfono.
        </BodyText>
        <VisualButton
          label="Ver bandeja de avisos"
          secondary
          onPress={() => router.push('/avisos')}
        />
      </InfoCard>
    </Screen>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;

  return StyleSheet.create({
    heading: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    subheading: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    disclosure: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.xs,
    },
    alertHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
    },
    warningBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor: '#fef3c7',
      padding: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      marginVertical: theme.spacing.xs,
    },
    sectionHeader: {
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.xs,
      gap: theme.spacing.sm,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    ruleTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    ruleSubtitle: {
      fontSize: 14,
      color: colors.secondary,
      marginTop: 2,
    },
    ruleActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: theme.spacing.sm,
    },
  });
}
