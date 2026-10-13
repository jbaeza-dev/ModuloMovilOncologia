import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  NotificationJobState,
} from '../../data/local/reminders/reminder-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

type FilterOption = 'todos' | 'programada' | 'observada' | 'cancelada';

export function NoticesTrayScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const { repository } = useLocalData();

  const [filter, setFilter] = useState<FilterOption>('todos');
  const [limit, setLimit] = useState(25);

  const loadNotifications = useCallback(async () => {
    if (!repository) return [];
    let estadoFilter: NotificationJobState | undefined;
    if (filter === 'programada') {
      estadoFilter = 'programada';
    } else if (filter === 'cancelada') {
      estadoFilter = 'cancelada';
    }

    const items = await repository.reminders.listNotifications({
      limit,
      estado: estadoFilter,
    });

    if (filter === 'observada') {
      return items.filter((item) => item.recibidaObservadaEn || item.abiertaEn);
    }

    return items;
  }, [repository, filter, limit]);

  const { value: notifications, loading } = useFocusedValue(
    loadNotifications,
    [] as NotificationItem[],
  );

  const getStatusBadge = (item: NotificationItem) => {
    if (item.abiertaEn) {
      return <StatusPill>Abierta en la app</StatusPill>;
    }
    if (item.recibidaObservadaEn) {
      return <StatusPill>Recepción observada</StatusPill>;
    }
    switch (item.estado) {
      case 'programada':
        return <StatusPill>Programada en el sistema</StatusPill>;
      case 'pendiente':
        return <StatusPill>Programación pendiente</StatusPill>;
      case 'cancelacion_pendiente':
        return <StatusPill>Cancelación en curso</StatusPill>;
      case 'cancelada':
        return <StatusPill>Cancelada</StatusPill>;
      case 'finalizada_sin_observacion':
        return <StatusPill>Finalizada sin observación</StatusPill>;
      case 'error':
        return <StatusPill>Error nativo</StatusPill>;
      default:
        return <StatusPill>{item.estado}</StatusPill>;
    }
  };

  return (
    <Screen title="Bandeja de avisos" backTo="/">
      <DemoBadge />

      <InfoCard>
        <SectionTitle>Avisos locales planificados</SectionTitle>
        <BodyText>
          Esta bandeja refleja la agenda generada en este dispositivo. Una fecha futura indica
          programación en el sistema operativo, no entrega anticipada.
        </BodyText>
      </InfoCard>

      {/* Selector de filtros */}
      <View style={styles.filterRow} accessibilityRole="tablist">
        {(
          [
            { id: 'todos', label: 'Todos' },
            { id: 'programada', label: 'Programados' },
            { id: 'observada', label: 'Observados' },
            { id: 'cancelada', label: 'Cancelados' },
          ] as const
        ).map((tab) => {
          const selected = filter === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`Filtrar por ${tab.label}`}
              onPress={() => setFilter(tab.id)}
              style={[styles.filterPill, selected && styles.filterPillSelected]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Lista de avisos */}
      {loading && notifications.length === 0 ? (
        <InfoCard>
          <BodyText>Cargando avisos…</BodyText>
        </InfoCard>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon="bell-off"
          title="Sin avisos en esta vista"
          description={
            filter === 'todos'
              ? 'No hay avisos locales registrados para este paciente. Configura tus recordatorios desde la sección de inicio o preferencias.'
              : 'No se encontraron avisos que coincidan con el filtro seleccionado.'
          }
        />
      ) : (
        <View style={styles.listContainer}>
          {notifications.map((item) => {
            const isVitales = item.tipo === 'registro_vitales';
            return (
              <InfoCard key={item.id}>
                <View style={styles.cardHeader}>
                  <View style={styles.typeBadge}>
                    <Feather
                      name={isVitales ? 'activity' : 'calendar'}
                      size={16}
                      color={appTheme.colors.primary}
                    />
                    <Text style={styles.typeText}>
                      {isVitales ? 'Signos vitales' : 'Medicación activa'}
                    </Text>
                  </View>
                  {getStatusBadge(item)}
                </View>

                <DetailRow
                  label="Fecha y hora prevista"
                  value={formatDate(item.fechaPrevistaUtc)}
                />

                {item.recibidaObservadaEn ? (
                  <DetailRow
                    label="Recepción observada"
                    value={formatDate(item.recibidaObservadaEn)}
                  />
                ) : null}

                {item.abiertaEn ? (
                  <DetailRow label="Abierta en la app" value={formatDate(item.abiertaEn)} />
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

          {notifications.length >= limit ? (
            <VisualButton
              label="Cargar más avisos"
              secondary
              onPress={() => setLimit((prev) => prev + 25)}
            />
          ) : null}
        </View>
      )}

      <VisualButton label="Gestionar recordatorios" onPress={() => router.push('/recordatorios')} />
    </Screen>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;

  return StyleSheet.create({
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
      minHeight: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    filterPillSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterText: {
      fontSize: 13,
      fontWeight: '600',
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
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    cardActions: {
      marginTop: theme.spacing.xs,
    },
  });
}
