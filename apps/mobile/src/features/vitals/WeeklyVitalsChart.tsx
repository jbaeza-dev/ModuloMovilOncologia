import { AppIcon as Feather } from '../../components/AppIcon';
import React, { useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { InfoCard } from '../../components/Visual';
import type { VitalWithSyncRecord } from '../../data/local/repository';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { getCivilPartsInTimeZone } from '../../services/reminders/reminder-status';

export type VitalsMetric = 'bp' | 'temp' | 'pulse';

export interface WeeklyVitalsChartProps {
  records: readonly VitalWithSyncRecord[];
  days?: number;
}

interface DayData {
  dateIso: string;
  dayLabel: string;
  dayShort: string;
  isToday: boolean;
  records: VitalWithSyncRecord[];
  latestRecord: VitalWithSyncRecord | null;
}

const METRIC_CONFIGS = {
  bp: {
    title: 'Presión arterial (mmHg)',
    axisScale: 'Escala: 60 a 160 mmHg (2 series)',
    minVal: 60,
    maxVal: 160,
  },
  temp: {
    title: 'Temperatura (°C)',
    axisScale: 'Escala: 35.0 °C a 39.0 °C',
    minVal: 35.0,
    maxVal: 39.0,
  },
  pulse: {
    title: 'Pulso (lpm)',
    axisScale: 'Escala: 50 a 110 lpm',
    minVal: 50,
    maxVal: 110,
  },
};

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function WeeklyVitalsChart({ records }: WeeklyVitalsChartProps) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);

  const [metric, setMetric] = useState<VitalsMetric>('bp');
  const [showTable, setShowTable] = useState(false);
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);

  // Generar los últimos 7 días calendario hasta hoy
  const weekDays = useMemo<DayData[]>(() => {
    const result: DayData[] = [];
    const today = getCivilPartsInTimeZone(new Date().toISOString()).civilDate;
    const now = new Date(today + 'T12:00:00');

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const isToday = i === 0;

      const dayRecords = records
        .filter((r) => getCivilPartsInTimeZone(r.fecha_registro).civilDate === dateIso)
        .sort((a, b) => a.fecha_registro.localeCompare(b.fecha_registro));

      result.push({
        dateIso,
        dayLabel: isToday ? 'Hoy' : DAY_NAMES[d.getDay()],
        dayShort: `${d.getDate()} ${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][d.getMonth()]}`,
        isToday,
        records: dayRecords,
        latestRecord: dayRecords.length > 0 ? dayRecords[dayRecords.length - 1] : null,
      });
    }

    return result;
  }, [records]);

  const baseline = METRIC_CONFIGS[metric];
  const measured = weekDays
    .flatMap((day) => {
      const row = day.latestRecord;
      return !row
        ? []
        : metric === 'bp'
          ? [row.presion_sistolica, row.presion_diastolica]
          : [metric === 'temp' ? row.temperatura : row.pulso];
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const minVal = Math.min(baseline.minVal, ...measured);
  const maxVal = Math.max(baseline.maxVal, ...measured);
  const config = {
    ...baseline,
    minVal,
    maxVal,
    axisScale: `Escala: ${minVal} a ${maxVal} ${metric === 'bp' ? 'mmHg' : metric === 'temp' ? '°C' : 'lpm'}`,
  };
  const heightFor = (value: number | null | undefined) =>
    value == null ? 0 : Math.max(2, Math.min(95, 2 + ((value - minVal) / (maxVal - minVal)) * 93));

  const handleMetricChange = (newMetric: VitalsMetric) => {
    setMetric(newMetric);
    setSelectedDayIso(null);
    AccessibilityInfo.announceForAccessibility(
      `Métrica cambiada a ${METRIC_CONFIGS[newMetric].title}.`,
    );
  };

  const selectedDay = selectedDayIso ? weekDays.find((d) => d.dateIso === selectedDayIso) : null;

  return (
    <InfoCard>
      {/* Selector de Métrica */}
      <View style={styles.metricTabs}>
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Ver gráfica de Presión arterial"
          accessibilityState={{ selected: metric === 'bp' }}
          onPress={() => handleMetricChange('bp')}
          style={[styles.metricTab, metric === 'bp' && styles.metricTabActive]}
        >
          <Text style={[styles.metricTabText, metric === 'bp' && styles.metricTabTextActive]}>
            Presión
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Ver gráfica de Temperatura"
          accessibilityState={{ selected: metric === 'temp' }}
          onPress={() => handleMetricChange('temp')}
          style={[styles.metricTab, metric === 'temp' && styles.metricTabActive]}
        >
          <Text style={[styles.metricTabText, metric === 'temp' && styles.metricTabTextActive]}>
            Temperatura
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Ver gráfica de Pulso"
          accessibilityState={{ selected: metric === 'pulse' }}
          onPress={() => handleMetricChange('pulse')}
          style={[styles.metricTab, metric === 'pulse' && styles.metricTabActive]}
        >
          <Text style={[styles.metricTabText, metric === 'pulse' && styles.metricTabTextActive]}>
            Pulso
          </Text>
        </Pressable>
      </View>

      {/* Título de la métrica y escala de eje Y */}
      <View style={styles.chartHeader}>
        <Text style={styles.chartTitle}>{config.title}</Text>
        <Text style={styles.scaleText}>{config.axisScale}</Text>
      </View>

      {/* Leyenda diferenciada (no depende únicamente de color) */}
      <View style={styles.legendRow}>
        {metric === 'bp' ? (
          <>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: appTheme.colors.primary }]} />
              <Text style={styles.legendLabel}>▲ Sistólica (sólida)</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  {
                    backgroundColor: appTheme.colors.secondary,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                  },
                ]}
              />
              <Text style={styles.legendLabel}>▼ Diastólica (punteada)</Text>
            </View>
          </>
        ) : (
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: appTheme.colors.primary }]} />
            <Text style={styles.legendLabel}>● Última medición diaria</Text>
          </View>
        )}
      </View>

      {/* Gráfica de 7 Días */}
      <View style={styles.chartArea} accessible={false}>
        {weekDays.map((day) => {
          const row = day.latestRecord;
          const hasData = Boolean(
            row &&
            (metric === 'bp'
              ? row.presion_sistolica != null || row.presion_diastolica != null
              : metric === 'temp'
                ? row.temperatura != null
                : row.pulso != null),
          );
          const count = day.records.length;
          const isSelected = selectedDayIso === day.dateIso;
          const hSysPercent = heightFor(row?.presion_sistolica);
          const hDiaPercent = heightFor(row?.presion_diastolica);
          const hSinglePercent = heightFor(metric === 'temp' ? row?.temperatura : row?.pulso);

          return (
            <Pressable
              key={day.dateIso}
              accessibilityRole="button"
              accessibilityLabel={`${day.dayLabel} ${day.dayShort}: ${
                hasData
                  ? metric === 'bp'
                    ? `Sistólica ${day.latestRecord?.presion_sistolica ?? '--'}, Diastólica ${day.latestRecord?.presion_diastolica ?? '--'}`
                    : metric === 'temp'
                      ? `${day.latestRecord?.temperatura ?? '--'} grados Celsius`
                      : `${day.latestRecord?.pulso ?? '--'} latidos por minuto`
                  : 'Sin registros'
              }${count > 1 ? `. ${count} tomas registradas` : ''}`}
              onPress={() => setSelectedDayIso(isSelected ? null : day.dateIso)}
              style={[styles.dayColumn, isSelected && styles.dayColumnSelected]}
            >
              {/* Área de barras */}
              <View style={styles.barsTrack}>
                {hasData ? (
                  metric === 'bp' ? (
                    <View style={styles.dualBars}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${hSysPercent}%`,
                            opacity: row?.presion_sistolica == null ? 0 : 1,
                            backgroundColor: appTheme.colors.primary,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${hDiaPercent}%`,
                            opacity: row?.presion_diastolica == null ? 0 : 1,
                            backgroundColor: appTheme.colors.secondary,
                            borderWidth: 1,
                            borderColor: appTheme.colors.border,
                            borderStyle: 'dashed',
                          },
                        ]}
                      />
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.barSingle,
                        {
                          height: `${hSinglePercent}%`,
                          backgroundColor: appTheme.colors.primary,
                        },
                      ]}
                    />
                  )
                ) : (
                  <View style={styles.noDataBar} />
                )}
              </View>

              {/* Insignia de múltiples tomas */}
              {count > 1 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{count}</Text>
                </View>
              ) : null}

              {/* Etiqueta del día */}
              <Text
                style={[
                  styles.dayLabelText,
                  day.isToday && styles.todayLabelText,
                  isSelected && styles.selectedLabelText,
                ]}
              >
                {day.dayLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Detalle del día seleccionado si hay múltiples tomas */}
      {selectedDay && selectedDay.records.length > 0 ? (
        <View style={styles.selectedDayBox}>
          <Text style={styles.selectedDayTitle}>
            Tomas del {selectedDay.dayLabel} ({selectedDay.dayShort}):
          </Text>
          {selectedDay.records.map((r, i) => (
            <View key={r.id} style={styles.detailItemRow}>
              <Text style={styles.detailTime}>
                Toma {i + 1} (
                {new Date(r.fecha_registro).toLocaleTimeString('es-CL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                )
              </Text>
              <Text style={styles.detailVal}>
                {metric === 'bp'
                  ? `${r.presion_sistolica ?? '--'} / ${r.presion_diastolica ?? '--'} mmHg`
                  : metric === 'temp'
                    ? `${r.temperatura ?? '--'} °C`
                    : `${r.pulso ?? '--'} lpm`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Botón para alternar tabla accesible TalkBack */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          showTable ? 'Ocultar tabla de valores' : 'Ver tabla de valores accesible'
        }
        onPress={() => setShowTable(!showTable)}
        style={styles.tableToggle}
      >
        <Text style={styles.tableToggleText}>
          {showTable ? 'Ocultar tabla de valores' : 'Ver tabla de valores (Accesible)'}
        </Text>
        <Feather
          name={showTable ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={appTheme.colors.primary}
        />
      </Pressable>

      {/* Tabla accesible de 7 días */}
      {showTable ? (
        <View style={styles.accessibleTable}>
          {weekDays.map((d) => (
            <View key={d.dateIso} style={styles.tableRow}>
              <Text style={styles.tableDayCol}>
                {d.dayLabel} ({d.dayShort})
              </Text>
              <Text style={styles.tableValCol}>
                {d.latestRecord
                  ? metric === 'bp'
                    ? `${d.latestRecord.presion_sistolica ?? '--'} / ${d.latestRecord.presion_diastolica ?? '--'} mmHg`
                    : metric === 'temp'
                      ? `${d.latestRecord.temperatura ?? '--'} °C`
                      : `${d.latestRecord.pulso ?? '--'} lpm`
                  : 'Sin registros'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </InfoCard>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    metricTabs: {
      flexDirection: 'row',
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.sm,
    },
    metricTab: {
      flex: 1,
      minHeight: 48,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    metricTabActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    metricTabText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    metricTabTextActive: {
      color: colors.onPrimary,
    },
    chartHeader: {
      marginTop: theme.spacing.xs,
      marginBottom: 2,
    },
    chartTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
    },
    scaleText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.secondary,
    },
    legendRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      marginVertical: theme.spacing.xs,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    legendSwatch: {
      width: 12,
      height: 12,
      borderRadius: 2,
    },
    legendLabel: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.text,
    },
    chartArea: {
      flexDirection: 'row',
      height: 140,
      paddingTop: 16,
      paddingBottom: 4,
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      borderBottomWidth: 1.5,
      borderBottomColor: colors.border,
      marginVertical: theme.spacing.sm,
    },
    dayColumn: {
      flex: 1,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: 2,
    },
    dayColumnSelected: {
      backgroundColor: colors.primaryContainer,
      borderRadius: 6,
    },
    barsTrack: {
      flex: 1,
      width: '100%',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    dualBars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 2,
      height: '100%',
    },
    bar: {
      width: 10,
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
    },
    barSingle: {
      width: 16,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
    },
    noDataBar: {
      width: 12,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.inputBorder,
      opacity: 0.5,
    },
    countBadge: {
      marginTop: 2,
      backgroundColor: colors.primaryContainer,
      borderRadius: 8,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    countBadgeText: {
      fontSize: 9.5,
      fontWeight: '800',
      color: colors.onPrimaryContainer,
    },
    dayLabelText: {
      fontSize: 11.5,
      fontWeight: '700',
      color: colors.text,
      marginTop: 4,
    },
    todayLabelText: {
      color: colors.primary,
      fontWeight: '800',
    },
    selectedLabelText: {
      color: colors.primary,
    },
    selectedDayBox: {
      padding: theme.spacing.sm,
      backgroundColor: colors.mutedSurface,
      borderRadius: theme.radius.sm,
      marginVertical: theme.spacing.xs,
      gap: 4,
    },
    selectedDayTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    detailItemRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    detailTime: {
      fontSize: 12,
      color: colors.secondary,
    },
    detailVal: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
    },
    tableToggle: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.xs,
      marginTop: theme.spacing.xs,
    },
    tableToggleText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.primary,
    },
    accessibleTable: {
      marginTop: theme.spacing.xs,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: theme.spacing.xs,
      gap: 6,
    },
    tableRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 3,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    tableDayCol: {
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.text,
    },
    tableValCol: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.text,
    },
  });
}
