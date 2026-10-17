import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import type { ActiveMedicationRecord } from '../../data/local/clinical-context/clinical-context-types';
import type { NotificationRecord, ReminderRule } from '../../data/local/reminders/reminder-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedList, useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { ExpoNotificationAdapter } from '../../services/notifications/expo-notification-adapter';
import type { NotificationPermissionState } from '../../services/notifications/notification-adapter';
import type { CoordinatorResult } from '../../services/reminders/notification-coordinator';
import { formatNextReminderLabel } from '../../services/reminders/reminder-status';
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
  if (!res) return 'Preparando avisos...';
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
      return 'Actualizando horario anterior';
    }
    return `Parcial: ${res.programadasConfirmadas} de ${res.totalDeseadas} confirmadas`;
  }
  if (res.status === 'error') {
    return 'No se pudieron programar todos los avisos';
  }
  return 'Preparando avisos...';
}

function getNextConfirmedLabelForRules(
  rules: ReminderRule[],
  futureNotifications: NotificationRecord[],
  nowIso: string,
): string | null {
  const enabledRulesById = new Map<string, ReminderRule>();
  for (const r of rules) {
    if (r.habilitado && r.eliminadoEl === null) {
      enabledRulesById.set(r.id, r);
    }
  }
  if (enabledRulesById.size === 0) return null;

  const confirmed = futureNotifications
    .filter((n) => {
      const rule = enabledRulesById.get(n.recordatorioId);
      if (!rule) return false;
      return (
        n.revision === rule.revision &&
        n.estado === 'programada' &&
        typeof n.idNativo === 'string' &&
        n.idNativo.trim().length > 0 &&
        n.fechaPrevistaUtc > nowIso
      );
    })
    .sort((a, b) => a.fechaPrevistaUtc.localeCompare(b.fechaPrevistaUtc));

  const nextNotif = confirmed[0];
  if (!nextNotif) return null;
  const nextRule = enabledRulesById.get(nextNotif.recordatorioId);
  return formatNextReminderLabel(
    nextNotif.fechaPrevistaUtc,
    nowIso,
    nextRule?.zonaHoraria ?? 'America/Santiago',
  );
}

export function RemindersListScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const {
    database,
    repository,
    patientId,
    notificationAdapter,
    reconcileReminders,
    bumpRemindersRevision,
    trackOperation,
  } = useLocalData();
  const fallbackAdapter = useMemo(() => new ExpoNotificationAdapter(), []);
  const adapter = notificationAdapter ?? fallbackAdapter;

  const [toggling, setToggling] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermissionState | null>(null);
  const [coordinatorResult, setCoordinatorResult] = useState<CoordinatorResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroupExpanded = (groupKey: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

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

  // Cargar medicamentos activos diferenciando catálogo vacío de error de lectura SQL
  const loadMedications = useCallback(async (): Promise<ActiveMedicationRecord[]> => {
    if (!repository || typeof repository.activeMedications !== 'function') return [];
    return repository.activeMedications();
  }, [repository]);

  const {
    items: medications,
    loading: loadingMedications,
    error: medicationsError,
    refresh: refreshMedications,
  } = useFocusedList<ActiveMedicationRecord>(loadMedications);

  const [scheduledNotifications, setScheduledNotifications] = useState<NotificationRecord[]>([]);

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
      if (repository && typeof repository.reminders.listNotifications === 'function') {
        const notifs = await repository.reminders.listNotifications({ estado: 'programada' });
        setScheduledNotifications(notifs);
      }
    } catch {
      // Reconciliación silente para no bloquear interfaz
    }
  }, [adapter, database, patientId, reconcileReminders, repository]);

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
            bumpRemindersRevision?.();
            await refreshPrefs();
            await checkAndReconcile();
            return;
          }
        }

        await repository.reminders.setPreferences(nextState);
        bumpRemindersRevision?.();
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
      bumpRemindersRevision?.();
      await checkAndReconcile();
    });
    await refreshRules();
  };

  const isBlockedInSettings = permissionState?.status === 'denied' && !permissionState?.canAskAgain;
  const isChannelBlocked = permissionState?.channelStatus === 'blocked';
  const nowIso = new Date().toISOString();

  const vitalRules = useMemo(
    () => rules.filter((r) => r.tipo === 'registro_vitales' && r.eliminadoEl === null),
    [rules],
  );
  const medicationRules = useMemo(
    () => rules.filter((r) => r.tipo === 'medicacion' && r.eliminadoEl === null),
    [rules],
  );

  const medicationIdsInCatalog = useMemo(
    () => new Set(medications.map((m) => m.id)),
    [medications],
  );
  const orphanMedicationRules = useMemo(
    () =>
      medicationRules.filter(
        (r) => !r.medicamentoId || !medicationIdsInCatalog.has(r.medicamentoId),
      ),
    [medicationRules, medicationIdsInCatalog],
  );

  const renderRuleRow = (rule: ReminderRule, actionLabel: string) => {
    const daysText = rule.diasSemana.map((d) => DAYS_MAP[d] ?? d).join(', ');
    const hoursText = rule.horasMinutos.join(', ');
    const nextSlot =
      prefs.enabled && rule.habilitado
        ? getNextConfirmedLabelForRules([rule], scheduledNotifications, nowIso)
        : null;

    return (
      <View key={rule.id} style={styles.ruleItemBox}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ruleTitle}>
              {rule.tipo === 'registro_vitales'
                ? 'Registro de signos vitales'
                : 'Horario de medicamento'}
            </Text>
            <Text style={styles.ruleSubtitle}>
              Días: {daysText} · Horas: {hoursText}
            </Text>
            {rule.fechaInicio || rule.fechaFin ? (
              <Text style={styles.ruleSubtitle}>
                Vigencia: {rule.fechaInicio ? formatDate(rule.fechaInicio) : 'Desde hoy'}
                {rule.fechaFin ? ` hasta ${formatDate(rule.fechaFin)}` : ''}
              </Text>
            ) : null}
            <Text style={styles.ruleStatusLine}>
              {!rule.habilitado
                ? 'Horario desactivado'
                : !prefs.enabled
                  ? 'Guardado (avisos generales en pausa)'
                  : nextSlot
                    ? `Próximo aviso: ${nextSlot}`
                    : 'Activo'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={`Activar ${rule.tipo}`}
            accessibilityState={{ checked: rule.habilitado }}
            onPress={() => void handleToggleRule(rule)}
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
            label={actionLabel}
            secondary
            onPress={() =>
              router.push({ pathname: '/recordatorios/editar', params: { id: rule.id } })
            }
          />
        </View>
      </View>
    );
  };

  return (
    <Screen title="Recordatorios">
      <DemoBadge />

      {/* Switch Maestro */}
      <InfoCard>
        <SectionTitle>Recordatorios locales</SectionTitle>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Activar recordatorios locales"
          accessibilityState={{ checked: prefs.enabled, disabled: toggling }}
          onPress={() => void handleToggleMaster()}
          style={styles.disclosure}
          disabled={toggling}
        >
          <View style={{ flex: 1, paddingRight: theme.spacing.sm }}>
            <Text style={styles.heading}>Activar recordatorios</Text>
            <BodyText>
              {prefs.enabled
                ? 'Los avisos se programan de forma local en este dispositivo.'
                : 'Avisos desactivados. Tus horarios guardados se mantienen listos para cuando los reactives.'}
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
            <Text style={[styles.heading, { color: '#dc2626' }]}>Atención con tus avisos</Text>
          </View>
          {coordinatorResult.incidencias.map((inc, idx) => (
            <BodyText key={idx} style={{ color: '#dc2626', fontSize: 13 }}>
              • {inc}
            </BodyText>
          ))}
          <VisualButton
            label="Reintentar programación"
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
          <SectionTitle>Estado de tus avisos</SectionTitle>
          <View style={styles.row}>
            <Text style={styles.subheading}>Cobertura actual:</Text>
            <StatusPill>{getStatusCoverageText(coordinatorResult)}</StatusPill>
          </View>

          {coordinatorResult?.cubiertoHastaIso ? (
            <BodyText>
              Avisos preparados hasta:{' '}
              <Text style={{ fontWeight: '700' }}>
                {formatDate(coordinatorResult.cubiertoHastaIso)}
              </Text>{' '}
              (se renuevan al abrir la aplicación).
            </BodyText>
          ) : null}

          {coordinatorResult && coordinatorResult.truncadas > 0 ? (
            <View style={styles.warningBox}>
              <Feather name="info" size={20} color="#b45309" />
              <BodyText>
                Se alcanzó el límite de avisos simultáneos del teléfono. Los avisos más próximos
                quedaron programados y se renovarán automáticamente al abrir QuimioCare.
              </BodyText>
            </View>
          ) : null}
        </InfoCard>
      ) : null}

      {/* SECCIÓN 1: MEDICIONES */}
      <View style={styles.sectionHeader}>
        <SectionTitle>Mediciones</SectionTitle>
        <BodyText>Aviso diario para registrar tu temperatura corporal y pulso.</BodyText>
      </View>

      {loadingRules ? (
        <InfoCard>
          <BodyText>Cargando recordatorios de medición...</BodyText>
        </InfoCard>
      ) : vitalRules.length === 0 ? (
        <InfoCard>
          <Text style={styles.ruleTitle}>Registro de signos vitales</Text>
          <BodyText>Sin recordatorio configurado.</BodyText>
          <VisualButton
            label="Configurar aviso"
            onPress={() =>
              router.push({
                pathname: '/recordatorios/editar',
                params: { tipo: 'registro_vitales' },
              })
            }
          />
        </InfoCard>
      ) : vitalRules.length === 1 ? (
        <InfoCard>{renderRuleRow(vitalRules[0], 'Cambiar horario')}</InfoCard>
      ) : (
        <InfoCard>
          <Text style={styles.ruleTitle}>Registro de signos vitales</Text>
          <BodyText>
            Tienes {vitalRules.length} horarios configurados. Se conservan todos tus horarios.
          </BodyText>
          {(() => {
            const nextVitalSlot = prefs.enabled
              ? getNextConfirmedLabelForRules(vitalRules, scheduledNotifications, nowIso)
              : null;
            return nextVitalSlot ? (
              <Text style={styles.ruleStatusLine}>Próximo aviso: {nextVitalSlot}</Text>
            ) : null;
          })()}
          <VisualButton
            label={expandedGroups['vitales'] ? 'Ocultar horarios' : 'Ver horarios'}
            secondary
            onPress={() => toggleGroupExpanded('vitales')}
          />
          {expandedGroups['vitales'] ? (
            <View style={styles.multiRuleContainer}>
              {vitalRules.map((rule) => renderRuleRow(rule, 'Cambiar horario'))}
            </View>
          ) : null}
        </InfoCard>
      )}

      {/* SECCIÓN 2: MEDICAMENTOS */}
      <View style={styles.sectionHeader}>
        <SectionTitle>Medicamentos</SectionTitle>
        <BodyText>
          Configura horarios de aviso para cada medicamento activo en tu tratamiento.
        </BodyText>
      </View>

      {loadingMedications ? (
        <InfoCard>
          <BodyText>Cargando medicamentos...</BodyText>
        </InfoCard>
      ) : medicationsError ? (
        <InfoCard>
          <View style={styles.alertHeader}>
            <Feather name="alert-circle" size={22} color="#dc2626" />
            <Text style={[styles.heading, { color: '#dc2626' }]}>
              No se pudieron cargar tus medicamentos
            </Text>
          </View>
          <BodyText>
            Ocurrió un problema al consultar los medicamentos guardados en este dispositivo.
          </BodyText>
          <VisualButton
            label="Reintentar"
            secondary
            onPress={() => {
              void refreshMedications();
            }}
          />
        </InfoCard>
      ) : medications.length === 0 && orphanMedicationRules.length === 0 ? (
        <InfoCard>
          <BodyText>Aún no hay medicamentos disponibles en tu perfil</BodyText>
        </InfoCard>
      ) : (
        <>
          {medications.map((med) => {
            const medRules = medicationRules.filter((r) => r.medicamentoId === med.id);
            const groupKey = `med-${med.id}`;
            const isExpanded = Boolean(expandedGroups[groupKey]);
            const nextMedSlot = prefs.enabled
              ? getNextConfirmedLabelForRules(medRules, scheduledNotifications, nowIso)
              : null;

            return (
              <InfoCard key={med.id}>
                <View style={styles.medHeader}>
                  <Text style={styles.ruleTitle}>{med.nombre}</Text>
                  {med.dosis || med.frecuencia ? (
                    <Text style={styles.ruleSubtitle}>
                      {[
                        med.dosis ? `Dosis: ${med.dosis}` : null,
                        med.frecuencia ? `Pauta: ${med.frecuencia}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  ) : null}
                  {med.fecha_inicio || med.fecha_fin ? (
                    <Text style={styles.ruleSubtitle}>
                      Indicaciones:{' '}
                      {med.fecha_inicio ? `Desde ${formatDate(med.fecha_inicio)}` : 'Activo'}
                      {med.fecha_fin ? ` hasta ${formatDate(med.fecha_fin)}` : ''}
                    </Text>
                  ) : null}
                </View>

                {medRules.length === 0 ? (
                  <View style={styles.medEmptyBox}>
                    <Text style={styles.ruleStatusLine}>Sin horarios configurados</Text>
                    <VisualButton
                      label="Configurar horarios"
                      onPress={() =>
                        router.push({
                          pathname: '/recordatorios/editar',
                          params: { tipo: 'medicacion', medicamentoId: med.id },
                        })
                      }
                    />
                  </View>
                ) : medRules.length === 1 ? (
                  renderRuleRow(medRules[0], 'Cambiar horarios')
                ) : (
                  <View style={styles.medEmptyBox}>
                    <BodyText>
                      Tienes {medRules.length} horarios configurados para este medicamento.
                    </BodyText>
                    {nextMedSlot ? (
                      <Text style={styles.ruleStatusLine}>Próximo aviso: {nextMedSlot}</Text>
                    ) : null}
                    <VisualButton
                      label={isExpanded ? 'Ocultar horarios' : 'Ver horarios'}
                      secondary
                      onPress={() => toggleGroupExpanded(groupKey)}
                    />
                    {isExpanded ? (
                      <View style={styles.multiRuleContainer}>
                        {medRules.map((rule) => renderRuleRow(rule, 'Cambiar horarios'))}
                      </View>
                    ) : null}
                  </View>
                )}
              </InfoCard>
            );
          })}

          {orphanMedicationRules.map((rule) => (
            <InfoCard key={rule.id}>{renderRuleRow(rule, 'Cambiar horarios')}</InfoCard>
          ))}
        </>
      )}

      {/* Acceso a la Bandeja de Avisos */}
      <InfoCard>
        <SectionTitle>Historial de avisos</SectionTitle>
        <BodyText>Revisa los avisos recibidos y programados en este teléfono.</BodyText>
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
      gap: 4,
    },
    medHeader: {
      marginBottom: theme.spacing.xs,
    },
    medEmptyBox: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    multiRuleContainer: {
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    ruleItemBox: {
      paddingTop: theme.spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
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
    ruleSummaryText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      marginTop: 2,
    },
    ruleSubtitle: {
      fontSize: 14,
      color: colors.secondary,
      marginTop: 2,
    },
    ruleStatusLine: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
      marginTop: 4,
    },
    ruleActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: theme.spacing.sm,
    },
  });
}
