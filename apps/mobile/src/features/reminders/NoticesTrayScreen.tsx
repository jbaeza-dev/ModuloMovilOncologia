import { AppIcon as Feather } from '../../components/AppIcon';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

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
  NotificationItem,
  ReminderStatusSnapshot,
} from '../../data/local/reminders/reminder-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import {
  classifyReminderStatus,
  resolveDeviceAvailability,
  type ReminderDeviceAvailability,
} from '../../services/reminders/reminder-status';
import { theme } from '../../theme';

type TrayTab = 'proximos' | 'actividad';

interface UpcomingItem {
  id: string;
  ruleId: string;
  tipo: 'registro_vitales' | 'medicacion';
  medicamentoId: string | null;
  medicamentoNombre?: string;
  fechaPrevistaUtc: string;
  zonaHoraria?: string | null;
}

export function NoticesTrayScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const { repository, notificationAdapter } = useLocalData();

  const [activeTab, setActiveTab] = useState<TrayTab>('proximos');
  const [limit, setLimit] = useState(25);
  const [showTechDetails, setShowTechDetails] = useState(false);

  // 1. Cargar Próximos usando la instantánea y el clasificador existente
  const loadUpcoming = useCallback(async (): Promise<{
    items: UpcomingItem[];
    snapshot: ReminderStatusSnapshot | null;
    deviceAvailability: ReminderDeviceAvailability;
  }> => {
    if (!repository?.reminders?.getReminderStatusSnapshot) {
      return { items: [], snapshot: null, deviceAvailability: 'available' };
    }
    const nowIso = new Date().toISOString();
    const snap = await repository.reminders.getReminderStatusSnapshot(nowIso);
    if (!snap) return { items: [], snapshot: null, deviceAvailability: 'available' };

    let permissionState = null;
    if (notificationAdapter) {
      permissionState = await notificationAdapter.getPermissionState();
    }
    const deviceAvailability = resolveDeviceAvailability(permissionState, null);

    const activeRules = snap.rules.filter((r) => r.eliminadoEl === null && r.habilitado);
    const upcomingList: UpcomingItem[] = [];

    for (const rule of activeRules) {
      const evalRes = classifyReminderStatus(snap, {
        ruleId: rule.id,
        permissionState,
      });
      if (evalRes.status === 'scheduled' && evalRes.fechaPrevistaUtc) {
        const med =
          rule.tipo === 'medicacion' && rule.medicamentoId
            ? snap.medications.find((m) => m.id === rule.medicamentoId)
            : undefined;

        upcomingList.push({
          id: evalRes.notificationId ?? `eval-${rule.id}`,
          ruleId: rule.id,
          tipo: rule.tipo,
          medicamentoId: rule.medicamentoId,
          medicamentoNombre: med?.nombre,
          fechaPrevistaUtc: evalRes.fechaPrevistaUtc,
          zonaHoraria: evalRes.zonaHoraria,
        });
      }
    }

    upcomingList.sort(
      (a, b) =>
        a.fechaPrevistaUtc.localeCompare(b.fechaPrevistaUtc) || a.ruleId.localeCompare(b.ruleId),
    );

    return { items: upcomingList, snapshot: snap, deviceAvailability };
  }, [repository, notificationAdapter]);

  const {
    value: upcomingData,
    loading: loadingUpcoming,
    error: errorUpcoming,
    refresh: refreshUpcoming,
  } = useFocusedValue(loadUpcoming, {
    items: [] as UpcomingItem[],
    snapshot: null as ReminderStatusSnapshot | null,
    deviceAvailability: 'available' as ReminderDeviceAvailability,
  });

  // 2. Cargar Actividad ordenada por COALESCE(abierta_en, recibida_observada_en) DESC
  const loadActivity = useCallback(async (): Promise<NotificationItem[]> => {
    if (!repository?.reminders?.listNotifications) return [];
    return repository.reminders.listNotifications({
      limit,
      soloObservadas: true,
      orderBy: 'actividad_reciente',
    });
  }, [repository, limit]);

  const {
    value: activityItems,
    loading: loadingActivity,
    error: errorActivity,
    refresh: refreshActivity,
  } = useFocusedValue(loadActivity, [] as NotificationItem[]);

  // 3. Cargar avisos técnicos / cancelaciones para la sección secundaria
  const loadCancellations = useCallback(async (): Promise<NotificationItem[]> => {
    if (!repository?.reminders?.listNotifications || !showTechDetails) return [];
    return repository.reminders.listNotifications({
      limit: 25,
      estado: 'cancelada',
    });
  }, [repository, showTechDetails]);

  const { value: cancelledItems } = useFocusedValue(loadCancellations, [] as NotificationItem[]);

  const getActivityBadge = (item: NotificationItem) => {
    if (item.abiertaEn) {
      return <StatusPill>Abierta en la aplicación</StatusPill>;
    }
    if (item.recibidaObservadaEn) {
      return <StatusPill>La aplicación detectó este aviso</StatusPill>;
    }
    return <StatusPill>{item.estado}</StatusPill>;
  };

  return (
    <Screen mascotPose="recordatorio" title="Bandeja de avisos">
      <DemoBadge />

      <InfoCard>
        <SectionTitle>Avisos planificados y actividad</SectionTitle>
        <BodyText>
          {activeTab === 'proximos'
            ? 'Próximo aviso de cada uno de tus horarios configurados. Una fecha futura indica programación en el dispositivo, no entrega anticipada.'
            : 'Historial de avisos detectados o abiertos en este teléfono. Una detección no implica lectura del paciente.'}
        </BodyText>
      </InfoCard>

      {/* Selector de vistas principales: Próximos y Actividad (con minHeight 48) */}
      <View style={styles.filterRow} accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'proximos' }}
          accessibilityLabel="Ver próximos avisos"
          onPress={() => setActiveTab('proximos')}
          style={[styles.filterPill, activeTab === 'proximos' && styles.filterPillSelected]}
        >
          <Text style={[styles.filterText, activeTab === 'proximos' && styles.filterTextSelected]}>
            Próximos
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'actividad' }}
          accessibilityLabel="Ver actividad observada"
          onPress={() => setActiveTab('actividad')}
          style={[styles.filterPill, activeTab === 'actividad' && styles.filterPillSelected]}
        >
          <Text style={[styles.filterText, activeTab === 'actividad' && styles.filterTextSelected]}>
            Actividad
          </Text>
        </Pressable>
      </View>

      {/* VISTA 1: PRÓXIMOS */}
      {activeTab === 'proximos' ? (
        <>
          {upcomingData.snapshot && !upcomingData.snapshot.preferences.enabled ? (
            <InfoCard>
              <View style={styles.alertHeader}>
                <Feather name="bell-off" size={20} color={appTheme.colors.warning} />
                <Text style={[styles.heading, { color: appTheme.colors.warning }]}>
                  Avisos en pausa
                </Text>
              </View>
              <BodyText>
                Tus avisos generales están en pausa. Tus horarios se conservan listos en este
                dispositivo.
              </BodyText>
            </InfoCard>
          ) : null}

          {upcomingData.deviceAvailability === 'channel_blocked' ? (
            <InfoCard>
              <View style={styles.alertHeader}>
                <Feather name="alert-triangle" size={20} color={appTheme.colors.error} />
                <Text style={[styles.heading, { color: appTheme.colors.error }]}>
                  Canal de notificaciones bloqueado
                </Text>
              </View>
              <BodyText>
                El canal de avisos de QuimioCare ha sido bloqueado en los Ajustes de Android. Para
                recibir avisos, debes habilitar el canal de recordatorios.
              </BodyText>
              <VisualButton
                label="Abrir Ajustes de Android"
                secondary
                onPress={() => {
                  void Linking.openSettings();
                }}
              />
            </InfoCard>
          ) : upcomingData.deviceAvailability === 'permission_blocked' ? (
            <InfoCard>
              <View style={styles.alertHeader}>
                <Feather name="alert-triangle" size={20} color={appTheme.colors.error} />
                <Text style={[styles.heading, { color: appTheme.colors.error }]}>
                  Permiso bloqueado
                </Text>
              </View>
              <BodyText>
                Las notificaciones están bloqueadas en los Ajustes de Android. Para recibir estos
                avisos, debes habilitar los permisos en el sistema.
              </BodyText>
              <VisualButton
                label="Abrir Ajustes de Android"
                secondary
                onPress={() => {
                  void Linking.openSettings();
                }}
              />
            </InfoCard>
          ) : upcomingData.deviceAvailability === 'permission_required' ? (
            <InfoCard>
              <View style={styles.alertHeader}>
                <Feather name="alert-circle" size={20} color={appTheme.colors.warning} />
                <Text style={[styles.heading, { color: appTheme.colors.warning }]}>
                  Permiso de notificaciones pendiente
                </Text>
              </View>
              <BodyText>
                QuimioCare necesita tu autorización para mostrar recordatorios en este teléfono.
              </BodyText>
              <VisualButton
                label="Habilitar notificaciones"
                secondary
                onPress={async () => {
                  if (notificationAdapter) {
                    try {
                      await notificationAdapter.requestPermission();
                      refreshUpcoming();
                    } catch {
                      void Linking.openSettings();
                    }
                  } else {
                    void Linking.openSettings();
                  }
                }}
              />
            </InfoCard>
          ) : null}

          {errorUpcoming ? (
            <InfoCard>
              <View style={styles.alertHeader}>
                <Feather name="alert-circle" size={20} color={appTheme.colors.error} />
                <Text style={[styles.heading, { color: appTheme.colors.error }]}>
                  No se pudieron cargar los avisos
                </Text>
              </View>
              <BodyText>
                Ocurrió un problema al leer el estado del sistema o los recordatorios en este
                dispositivo.
              </BodyText>
              <VisualButton label="Reintentar" secondary onPress={refreshUpcoming} />
            </InfoCard>
          ) : loadingUpcoming && upcomingData.items.length === 0 ? (
            <InfoCard>
              <BodyText>Cargando avisos…</BodyText>
            </InfoCard>
          ) : upcomingData.items.length === 0 ? (
            <EmptyState
              icon="bell-off"
              title="Sin avisos en esta vista"
              description="No hay avisos programados próximamente. Puedes revisar y configurar tus horarios en Recordatorios."
            />
          ) : (
            <View style={styles.listContainer}>
              {upcomingData.items.map((item) => {
                const isVitales = item.tipo === 'registro_vitales';
                const title = isVitales
                  ? 'Signos vitales'
                  : (item.medicamentoNombre ?? 'Mis medicamentos');

                return (
                  <InfoCard key={item.id}>
                    <View style={styles.cardHeader}>
                      <View style={styles.typeBadge}>
                        <Feather
                          name={isVitales ? 'activity' : 'calendar'}
                          size={18}
                          color={appTheme.colors.primary}
                        />
                        <Text style={styles.typeText}>{title}</Text>
                      </View>
                      <StatusPill>Programada en el sistema</StatusPill>
                    </View>

                    <DetailRow
                      label="Fecha y hora prevista"
                      value={formatDate(item.fechaPrevistaUtc)}
                    />

                    <View style={styles.cardActions}>
                      {isVitales ? (
                        <VisualButton
                          label="Registrar signos vitales"
                          secondary
                          onPress={() => router.push('/vitales/registrar')}
                        />
                      ) : (
                        <VisualButton
                          label="Consultar medicamentos"
                          secondary
                          onPress={() => router.push('/perfil/medicacion')}
                        />
                      )}
                    </View>
                  </InfoCard>
                );
              })}
            </View>
          )}
        </>
      ) : null}

      {/* VISTA 2: ACTIVIDAD */}
      {activeTab === 'actividad' ? (
        <>
          {errorActivity ? (
            <InfoCard>
              <View style={styles.alertHeader}>
                <Feather name="alert-circle" size={20} color={appTheme.colors.error} />
                <Text style={[styles.heading, { color: appTheme.colors.error }]}>
                  No se pudo cargar la actividad
                </Text>
              </View>
              <BodyText>
                Ocurrió un problema al leer el historial de avisos en este dispositivo.
              </BodyText>
              <VisualButton label="Reintentar" secondary onPress={refreshActivity} />
            </InfoCard>
          ) : loadingActivity && activityItems.length === 0 ? (
            <InfoCard>
              <BodyText>Cargando actividad…</BodyText>
            </InfoCard>
          ) : activityItems.length === 0 ? (
            <EmptyState
              icon="clock"
              title="Sin avisos en esta vista"
              description="No se ha detectado actividad de avisos en este dispositivo aún."
            />
          ) : (
            <View style={styles.listContainer}>
              {activityItems.map((item) => {
                const isVitales = item.tipo === 'registro_vitales';
                return (
                  <InfoCard key={item.id}>
                    <View style={styles.cardHeader}>
                      <View style={styles.typeBadge}>
                        <Feather
                          name={isVitales ? 'activity' : 'calendar'}
                          size={18}
                          color={appTheme.colors.primary}
                        />
                        <Text style={styles.typeText}>
                          {isVitales ? 'Signos vitales' : 'Mis medicamentos'}
                        </Text>
                      </View>
                      {getActivityBadge(item)}
                    </View>

                    <DetailRow
                      label="Fecha y hora prevista"
                      value={formatDate(item.fechaPrevistaUtc)}
                    />

                    {item.recibidaObservadaEn ? (
                      <DetailRow
                        label="Detección de aviso"
                        value={formatDate(item.recibidaObservadaEn)}
                      />
                    ) : null}

                    {item.abiertaEn ? (
                      <DetailRow
                        label="Abierta en la aplicación"
                        value={formatDate(item.abiertaEn)}
                      />
                    ) : null}

                    {item.error ? <DetailRow label="Detalle de error" value={item.error} /> : null}

                    <View style={styles.cardActions}>
                      {isVitales ? (
                        <VisualButton
                          label="Registrar signos vitales"
                          secondary
                          onPress={() => router.push('/vitales/registrar')}
                        />
                      ) : (
                        <VisualButton
                          label="Consultar medicación"
                          secondary
                          onPress={() => router.push('/perfil/medicacion')}
                        />
                      )}
                    </View>
                  </InfoCard>
                );
              })}

              {activityItems.length >= limit ? (
                <VisualButton
                  label="Cargar más avisos"
                  secondary
                  onPress={() => setLimit((prev) => prev + 25)}
                />
              ) : null}
            </View>
          )}
        </>
      ) : null}

      {/* SECCIÓN SECUNDARIA: DETALLES DE AVISOS Y CANCELACIONES */}
      <InfoCard>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            showTechDetails
              ? 'Ocultar detalles técnicos y cancelaciones'
              : 'Ver detalles técnicos y cancelaciones'
          }
          accessibilityState={{ expanded: showTechDetails }}
          onPress={() => setShowTechDetails((prev) => !prev)}
          style={styles.detailsToggle}
        >
          <Text style={styles.detailsToggleText}>
            {showTechDetails
              ? 'Ocultar detalles técnicos y cancelaciones'
              : 'Ver detalles técnicos y cancelaciones'}
          </Text>
          <Feather
            name={showTechDetails ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={appTheme.colors.primary}
          />
        </Pressable>

        {showTechDetails ? (
          <View style={styles.techDetailsContainer}>
            <BodyText>
              Avisos cancelados por modificación de horario o término de tratamiento:
            </BodyText>
            {cancelledItems.length === 0 ? (
              <BodyText style={{ color: appTheme.colors.secondary, fontStyle: 'italic' }}>
                No hay avisos cancelados registrados.
              </BodyText>
            ) : (
              cancelledItems.map((item) => (
                <View key={item.id} style={styles.cancelledRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.typeText}>
                      {item.tipo === 'registro_vitales' ? 'Signos vitales' : 'Medicación'}
                    </Text>
                    <Text style={styles.cancelledSubtext}>
                      Previsto: {formatDate(item.fechaPrevistaUtc)}
                    </Text>
                  </View>
                  <StatusPill>Cancelada</StatusPill>
                </View>
              ))
            )}
          </View>
        ) : null}
      </InfoCard>

      <VisualButton label="Gestionar recordatorios" onPress={() => router.push('/recordatorios')} />
    </Screen>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;

  return StyleSheet.create({
    heading: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    filterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.xs,
    },
    filterPill: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 48,
      minWidth: 48,
      justifyContent: 'center',
      alignItems: 'center',
    },
    filterPillSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    filterTextSelected: {
      color: colors.onPrimary,
    },
    listContainer: {
      gap: theme.spacing.md,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    typeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    typeText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    cardActions: {
      marginTop: theme.spacing.xs,
    },
    alertHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: 4,
    },
    detailsToggle: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    detailsToggleText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
    techDetailsContainer: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    cancelledRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: theme.spacing.sm,
    },
    cancelledSubtext: {
      fontSize: 13,
      color: colors.secondary,
      marginTop: 2,
    },
  });
}
