import { AppIcon as Feather } from '../../components/AppIcon';
import React, { useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { InfoCard } from '../../components/Visual';
import type { VitalWithSyncRecord } from '../../data/local/repository';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { getCivilPartsInTimeZone } from '../../services/reminders/reminder-status';

export type VitalsMetric = 'bp' | 'temp' | 'pulse' | 'sat' | 'pain';

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

const METRIC_CONFIGS: Record<
  VitalsMetric,
  {
    title: string;
    unit: string;
    axisScale: string;
    minVal: number;
    maxVal: number;
  }
> = {
  bp: {
    title: 'Presión arterial (mmHg)',
    unit: 'mmHg',
    axisScale: 'Escala: 60 a 160 mmHg (2 series)',
    minVal: 60,
    maxVal: 160,
  },
  temp: {
    title: 'Temperatura (°C)',
    unit: '°C',
    axisScale: 'Escala: 35.0 °C a 39.0 °C',
    minVal: 35.0,
    maxVal: 39.0,
  },
  pulse: {
    title: 'Pulso (lpm)',
    unit: 'lpm',
    axisScale: 'Escala: 50 a 110 lpm',
    minVal: 50,
    maxVal: 110,
  },
  sat: {
    title: 'Saturación de oxígeno (%)',
    unit: '%',
    axisScale: 'Escala: 85 a 100 %',
    minVal: 85,
    maxVal: 100,
  },
  pain: {
    title: 'Dolor ENA (0 a 10)',
    unit: 'ENA',
    axisScale: 'Escala: 0 (sin dolor) a 10',
    minVal: 0,
    maxVal: 10,
  },
};

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function getMetricValue(record: VitalWithSyncRecord | null, metric: VitalsMetric): number | null {
  if (!record) return null;
  switch (metric) {
    case 'temp':
      return record.temperatura;
    case 'pulse':
      return record.pulso;
    case 'sat':
      return record.saturacion_o2;
    case 'pain':
      return record.dolor_ena ?? null;
    default:
      return null;
  }
}

export interface DailyMetricStats {
  value: number | null;
  systolic: number | null;
  diastolic: number | null;
  count: number;
  isAverage: boolean;
}

export function calculateDailyMetricStats(
  dayRecords: VitalWithSyncRecord[],
  metric: VitalsMetric,
): DailyMetricStats {
  if (!dayRecords.length) {
    return { value: null, systolic: null, diastolic: null, count: 0, isAverage: false };
  }

  if (metric === 'bp') {
    const sysVals = dayRecords
      .map((r) => r.presion_sistolica)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    const diaVals = dayRecords
      .map((r) => r.presion_diastolica)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

    const count = Math.max(sysVals.length, diaVals.length);
    if (count === 0) {
      return { value: null, systolic: null, diastolic: null, count: 0, isAverage: false };
    }

    const avgSys = sysVals.length
      ? Math.round(sysVals.reduce((a, b) => a + b, 0) / sysVals.length)
      : null;
    const avgDia = diaVals.length
      ? Math.round(diaVals.reduce((a, b) => a + b, 0) / diaVals.length)
      : null;

    return {
      value: null,
      systolic: avgSys,
      diastolic: avgDia,
      count,
      isAverage: count > 1,
    };
  }

  const vals = dayRecords
    .map((r) => getMetricValue(r, metric))
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

  if (!vals.length) {
    return { value: null, systolic: null, diastolic: null, count: 0, isAverage: false };
  }

  const sum = vals.reduce((a, b) => a + b, 0);
  const avg = sum / vals.length;
  const finalVal =
    metric === 'temp' || metric === 'pain' ? Math.round(avg * 10) / 10 : Math.round(avg);

  return {
    value: finalVal,
    systolic: null,
    diastolic: null,
    count: vals.length,
    isAverage: vals.length > 1,
  };
}

function findLatestForMetric(
  dayRecords: VitalWithSyncRecord[],
  metric: VitalsMetric,
): VitalWithSyncRecord | null {
  if (!dayRecords.length) return null;
  for (let i = dayRecords.length - 1; i >= 0; i--) {
    const r = dayRecords[i];
    if (metric === 'bp') {
      if (r.presion_sistolica != null || r.presion_diastolica != null) return r;
    } else if (metric === 'temp') {
      if (r.temperatura != null) return r;
    } else if (metric === 'pulse') {
      if (r.pulso != null) return r;
    } else if (metric === 'sat') {
      if (r.saturacion_o2 != null) return r;
    } else if (metric === 'pain') {
      if (r.dolor_ena != null) return r;
    }
  }
  return dayRecords[dayRecords.length - 1];
}

export function formatBarTopLabel(
  stats: DailyMetricStats,
  currentMetric: VitalsMetric,
): string | null {
  if (!stats.count) return null;
  const prefix = stats.isAverage ? '~' : '';
  if (currentMetric === 'bp') {
    if (stats.systolic == null && stats.diastolic == null) return null;
    return `${stats.systolic ?? '--'}/${stats.diastolic ?? '--'}`;
  }
  if (currentMetric === 'temp') {
    if (stats.value == null) return null;
    return `${prefix}${stats.value}°`;
  }
  if (currentMetric === 'pulse') {
    if (stats.value == null) return null;
    return `${prefix}${stats.value}`;
  }
  if (currentMetric === 'sat') {
    if (stats.value == null) return null;
    return `${prefix}${stats.value}%`;
  }
  if (currentMetric === 'pain') {
    if (stats.value == null) return null;
    return `${prefix}${stats.value}`;
  }
  return null;
}

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
      const stats = calculateDailyMetricStats(day.records, metric);
      if (!stats.count) return [];
      if (metric === 'bp') {
        return [stats.systolic, stats.diastolic];
      }
      return [stats.value];
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  const minVal = Math.min(baseline.minVal, ...measured);
  const maxVal = Math.max(baseline.maxVal, ...measured);
  const config = {
    ...baseline,
    minVal,
    maxVal,
    axisScale: `Escala: ${minVal} a ${maxVal} ${baseline.unit}`,
  };

  const heightFor = (value: number | null | undefined) => {
    if (value == null) return 0;
    if (metric === 'pain' && value === 0) return 8;
    if (maxVal === minVal) return 50;
    if (metric === 'temp') {
      const ratio = Math.max(0, Math.min(1, (value - minVal) / (maxVal - minVal)));
      return Math.max(18, Math.min(94, 18 + ratio * 74));
    }
    return Math.max(6, Math.min(95, 6 + ((value - minVal) / (maxVal - minVal)) * 88));
  };

  const handleMetricChange = (newMetric: VitalsMetric) => {
    setMetric(newMetric);
    setSelectedDayIso(null);
    AccessibilityInfo.announceForAccessibility(
      `Métrica cambiada a ${METRIC_CONFIGS[newMetric].title}.`,
    );
  };

  const selectedDay = selectedDayIso ? weekDays.find((d) => d.dateIso === selectedDayIso) : null;

  const METRIC_TABS: Array<{ key: VitalsMetric; label: string; a11y: string }> = [
    { key: 'bp', label: 'Presión', a11y: 'Ver gráfica de Presión arterial' },
    { key: 'temp', label: 'Temp', a11y: 'Ver gráfica de Temperatura' },
    { key: 'pulse', label: 'Pulso', a11y: 'Ver gráfica de Pulso' },
    { key: 'sat', label: 'Sat O₂', a11y: 'Ver gráfica de Saturación de oxígeno' },
    { key: 'pain', label: 'Dolor', a11y: 'Ver gráfica de Dolor ENA' },
  ];

  return (
    <InfoCard>
      {/* Selector de Métrica */}
      <View style={styles.metricTabs}>
        {METRIC_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.a11y}
            accessibilityState={{ selected: metric === tab.key }}
            onPress={() => handleMetricChange(tab.key)}
            style={[styles.metricTab, metric === tab.key && styles.metricTabActive]}
          >
            <Text style={[styles.metricTabText, metric === tab.key && styles.metricTabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Título de la métrica y escala de eje Y */}
      <View style={styles.chartHeader}>
        <Text style={styles.chartTitle}>{config.title}</Text>
        <Text style={styles.scaleText}>{config.axisScale}</Text>
      </View>

      {/* Leyenda diferenciada */}
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
        ) : metric === 'pain' ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: appTheme.colors.primary }]} />
            <Text style={styles.legendLabel}>● Dolor ENA (0 = sin dolor medido)</Text>
          </View>
        ) : metric === 'temp' ? (
          <>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: appTheme.colors.primary }]} />
              <Text style={styles.legendLabel}>● Temperatura normal (&lt;37.3 °C)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: '#E11D48' }]} />
              <Text style={styles.legendLabel}>● Fiebre (≥38.0 °C)</Text>
            </View>
          </>
        ) : (
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: appTheme.colors.primary }]} />
            <Text style={styles.legendLabel}>● Medición diaria (promedio si hay varias tomas)</Text>
          </View>
        )}
      </View>

      {/* Gráfica de 7 Días */}
      <View style={styles.chartArea} accessible={false}>
        {/* Líneas clínicas de referencia para temperatura */}
        {metric === 'temp' ? (
          <>
            <View
              style={[
                styles.referenceLine,
                { bottom: `${heightFor(38.0)}%`, borderColor: '#F43F5E' },
              ]}
              pointerEvents="none"
            >
              <Text style={[styles.referenceLineLabel, { color: '#E11D48' }]}>38° Fiebre</Text>
            </View>
            <View
              style={[
                styles.referenceLine,
                { bottom: `${heightFor(37.0)}%`, borderColor: appTheme.colors.border },
              ]}
              pointerEvents="none"
            >
              <Text style={[styles.referenceLineLabel, { color: appTheme.colors.secondary }]}>
                37°
              </Text>
            </View>
          </>
        ) : null}
        {weekDays.map((day) => {
          const stats = calculateDailyMetricStats(day.records, metric);
          const hasData = stats.count > 0;
          const count = stats.count;
          const isSelected = selectedDayIso === day.dateIso;
          const hSysPercent = heightFor(stats.systolic);
          const hDiaPercent = heightFor(stats.diastolic);
          const hSinglePercent = heightFor(stats.value);

          let a11yDesc = 'Sin registros';
          if (hasData) {
            const avgSuffix = stats.isAverage ? ' (promedio del día)' : '';
            if (metric === 'bp') {
              a11yDesc = `Sistólica ${stats.systolic ?? '--'}, Diastólica ${stats.diastolic ?? '--'}${avgSuffix}`;
            } else if (metric === 'temp') {
              a11yDesc = `${stats.value ?? '--'} grados Celsius${avgSuffix}`;
            } else if (metric === 'pulse') {
              a11yDesc = `${stats.value ?? '--'} latidos por minuto${avgSuffix}`;
            } else if (metric === 'sat') {
              a11yDesc = `${stats.value ?? '--'} por ciento de saturación${avgSuffix}`;
            } else if (metric === 'pain') {
              a11yDesc = `Dolor ENA ${stats.value ?? '--'} de 10${stats.value === 0 ? ' (sin dolor)' : ''}${avgSuffix}`;
            }
          }

          return (
            <Pressable
              key={day.dateIso}
              accessibilityRole="button"
              accessibilityLabel={`${day.dayLabel} ${day.dayShort}: ${a11yDesc}${count > 1 ? `. ${count} tomas registradas` : ''}`}
              onPress={() => setSelectedDayIso(isSelected ? null : day.dateIso)}
              style={[styles.dayColumn, isSelected && styles.dayColumnSelected]}
            >
              {/* Valor medido arriba de la barra */}
              <View style={styles.topLabelContainer}>
                {hasData ? (
                  <Text
                    style={[styles.barTopLabel, isSelected && styles.barTopLabelSelected]}
                    numberOfLines={1}
                  >
                    {formatBarTopLabel(stats, metric)}
                  </Text>
                ) : null}
              </View>

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
                            opacity: stats.systolic == null ? 0 : 1,
                            backgroundColor: appTheme.colors.primary,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${hDiaPercent}%`,
                            opacity: stats.diastolic == null ? 0 : 1,
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
                          backgroundColor:
                            metric === 'temp' && stats.value != null && stats.value >= 38.0
                              ? '#E11D48'
                              : metric === 'temp' && stats.value != null && stats.value >= 37.3
                                ? '#D97706'
                                : appTheme.colors.primary,
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

      {/* Detalle del día seleccionado si hay tomas */}
      {selectedDay && selectedDay.records.length > 0 ? (
        <View style={styles.selectedDayBox}>
          <Text style={styles.selectedDayTitle}>
            Tomas del {selectedDay.dayLabel} ({selectedDay.dayShort}):
          </Text>
          {selectedDay.records.map((r, i) => {
            let valText = '--';
            if (metric === 'bp') {
              valText = `${r.presion_sistolica ?? '--'} / ${r.presion_diastolica ?? '--'} mmHg`;
            } else if (metric === 'temp') {
              valText = r.temperatura != null ? `${r.temperatura} °C` : '--';
            } else if (metric === 'pulse') {
              valText = r.pulso != null ? `${r.pulso} lpm` : '--';
            } else if (metric === 'sat') {
              valText = r.saturacion_o2 != null ? `${r.saturacion_o2} %` : '--';
            } else if (metric === 'pain') {
              valText = r.dolor_ena != null ? `${r.dolor_ena}/10` : '--';
            }
            return (
              <View key={r.id} style={styles.detailItemRow}>
                <Text style={styles.detailTime}>
                  Toma {i + 1} (
                  {new Date(r.fecha_registro).toLocaleTimeString('es-CL', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  )
                </Text>
                <Text style={styles.detailVal}>{valText}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Botón para alternar tabla accesible */}
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
          {weekDays.map((d) => {
            const row = findLatestForMetric(d.records, metric);
            let tableVal = 'Sin registros';
            if (row) {
              if (metric === 'bp') {
                tableVal = `${row.presion_sistolica ?? '--'} / ${row.presion_diastolica ?? '--'} mmHg`;
              } else if (metric === 'temp') {
                tableVal = row.temperatura != null ? `${row.temperatura} °C` : 'Sin registro';
              } else if (metric === 'pulse') {
                tableVal = row.pulso != null ? `${row.pulso} lpm` : 'Sin registro';
              } else if (metric === 'sat') {
                tableVal = row.saturacion_o2 != null ? `${row.saturacion_o2} %` : 'Sin registro';
              } else if (metric === 'pain') {
                tableVal = row.dolor_ena != null ? `${row.dolor_ena}/10` : 'Sin registro';
              }
            }
            return (
              <View key={d.dateIso} style={styles.tableRow}>
                <Text style={styles.tableDayCol}>
                  {d.dayLabel} ({d.dayShort})
                </Text>
                <Text style={styles.tableValCol}>{tableVal}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </InfoCard>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    metricTabs: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.sm,
    },
    metricTab: {
      flexGrow: 1,
      minWidth: '17%',
      minHeight: 44,
      paddingHorizontal: 6,
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
      fontSize: 12.5,
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
      position: 'relative',
      flexDirection: 'row',
      height: 165,
      paddingTop: 24,
      paddingBottom: 4,
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      borderBottomWidth: 1.5,
      borderBottomColor: colors.border,
      marginVertical: theme.spacing.sm,
    },
    referenceLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      borderBottomWidth: 1,
      borderStyle: 'dashed',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingRight: 4,
      zIndex: 0,
    },
    referenceLineLabel: {
      fontSize: 9.5,
      fontWeight: '700',
      marginTop: -14,
    },
    topLabelContainer: {
      minHeight: 16,
      justifyContent: 'flex-end',
      alignItems: 'center',
      marginBottom: 2,
      zIndex: 2,
    },
    barTopLabel: {
      fontSize: 9.5,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    barTopLabelSelected: {
      color: colors.primary,
      fontWeight: '800',
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
      width: 14,
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
