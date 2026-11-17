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

const PLOT_TOP = 26;
const PLOT_HEIGHT = 128;
const FEVER = '#E11D48';
const WARM = '#D97706';

/** Segmento entre dos puntos, dibujado con una vista rotada (sin dependencias nativas). */
function LineSegment({
  x1,
  y1,
  x2,
  y2,
  color,
  dashed,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  dashed: boolean;
}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const thickness = 3;
  const centerY = (y1 + y2) / 2;
  const base = {
    position: 'absolute' as const,
    left: (x1 + x2) / 2 - length / 2,
    width: length,
    transform: [{ rotate: `${angle}rad` }],
  };
  if (dashed) {
    const dashes = Math.max(1, Math.floor(length / 9));
    return (
      <View
        style={[
          base,
          {
            top: centerY - thickness / 2,
            height: thickness,
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
        ]}
      >
        {Array.from({ length: dashes }, (_, i) => (
          <View
            key={i}
            style={{ width: 5, height: thickness, borderRadius: 2, backgroundColor: color }}
          />
        ))}
      </View>
    );
  }
  return (
    <>
      <View
        style={[
          base,
          { top: centerY - 4, height: 8, borderRadius: 4, backgroundColor: color, opacity: 0.14 },
        ]}
      />
      <View
        style={[
          base,
          {
            top: centerY - thickness / 2,
            height: thickness,
            borderRadius: thickness,
            backgroundColor: color,
          },
        ]}
      />
    </>
  );
}

export function WeeklyVitalsChart({ records }: WeeklyVitalsChartProps) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);

  const [metric, setMetric] = useState<VitalsMetric>('bp');
  const [showTable, setShowTable] = useState(false);
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

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
    if (maxVal === minVal) return 50;
    return Math.max(4, Math.min(96, 4 + ((value - minVal) / (maxVal - minVal)) * 92));
  };

  const columnWidth = chartWidth / weekDays.length;
  const columnX = (index: number) => columnWidth * (index + 0.5);
  const yFor = (pct: number) => PLOT_TOP + PLOT_HEIGHT * (1 - pct / 100);
  const topValueFor = (stats: DailyMetricStats) =>
    metric === 'bp' ? (stats.systolic ?? stats.diastolic) : stats.value;
  const pointColor = (value: number) =>
    metric === 'temp' && value >= 38.0
      ? FEVER
      : metric === 'temp' && value >= 37.3
        ? WARM
        : appTheme.colors.primary;

  const seriesDefs: Array<{
    key: string;
    dashed: boolean;
    pick: (stats: DailyMetricStats) => number | null;
  }> =
    metric === 'bp'
      ? [
          { key: 'sistolica', dashed: false, pick: (st) => st.systolic },
          { key: 'diastolica', dashed: true, pick: (st) => st.diastolic },
        ]
      : [{ key: 'valor', dashed: false, pick: (st) => st.value }];
  const series = seriesDefs.map((serie) => {
    const color = serie.dashed ? appTheme.colors.secondary : appTheme.colors.primary;
    const points = weekDays.flatMap((day, index) => {
      const value = serie.pick(calculateDailyMetricStats(day.records, metric));
      if (value == null || !Number.isFinite(value)) return [];
      return [
        {
          index,
          x: columnX(index),
          y: yFor(heightFor(value)),
          color: serie.dashed ? color : pointColor(value),
        },
      ];
    });
    return { key: serie.key, dashed: serie.dashed, color, points };
  });

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
              <View style={[styles.legendLine, { backgroundColor: appTheme.colors.primary }]} />
              <Text style={styles.legendLabel}>▲ Sistólica (sólida)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendDashes}>
                {[0, 1, 2].map((i) => (
                  <View
                    key={i}
                    style={[styles.legendDash, { backgroundColor: appTheme.colors.secondary }]}
                  />
                ))}
              </View>
              <Text style={styles.legendLabel}>▼ Diastólica (punteada)</Text>
            </View>
          </>
        ) : metric === 'pain' ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { borderColor: appTheme.colors.primary }]} />
            <Text style={styles.legendLabel}>Dolor ENA (0 = sin dolor medido)</Text>
          </View>
        ) : metric === 'temp' ? (
          <>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { borderColor: appTheme.colors.primary }]} />
              <Text style={styles.legendLabel}>Normal (&lt;37.3 °C)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { borderColor: FEVER }]} />
              <Text style={styles.legendLabel}>Fiebre (≥38.0 °C)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { borderColor: WARM }]} />
              <Text style={styles.legendLabel}>Temperatura elevada (37.3 a 37.9 °C)</Text>
            </View>
          </>
        ) : (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { borderColor: appTheme.colors.primary }]} />
            <Text style={styles.legendLabel}>Medición diaria (promedio si hay varias tomas)</Text>
          </View>
        )}
      </View>

      {/* Gráfica de líneas de 7 días */}
      <View
        style={styles.chartArea}
        accessible={false}
        onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
      >
        {/* Capa visual: cuadrícula, referencias, líneas y puntos (TalkBack lee las columnas). */}
        <View
          style={[StyleSheet.absoluteFill, styles.plotLayer]}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {[0, 50, 100].map((pct) => (
            <View key={pct} style={[styles.gridLine, { top: yFor(pct) }]} />
          ))}
          {metric === 'temp' ? (
            <>
              <View
                style={[styles.referenceLine, { top: yFor(heightFor(38.0)), borderColor: FEVER }]}
              >
                <Text style={[styles.referenceLineLabel, { color: FEVER }]}>38° Fiebre</Text>
              </View>
              <View
                style={[
                  styles.referenceLine,
                  { top: yFor(heightFor(37.0)), borderColor: appTheme.colors.inputBorder },
                ]}
              >
                <Text style={[styles.referenceLineLabel, { color: appTheme.colors.secondary }]}>
                  37°
                </Text>
              </View>
            </>
          ) : null}
          {chartWidth > 0
            ? series.map((serie) => (
                <React.Fragment key={serie.key}>
                  {serie.points.slice(1).map((point, index) => {
                    const previous = serie.points[index]!;
                    return (
                      <LineSegment
                        key={`${serie.key}-seg-${point.index}`}
                        x1={previous.x}
                        y1={previous.y}
                        x2={point.x}
                        y2={point.y}
                        color={serie.color}
                        dashed={serie.dashed}
                      />
                    );
                  })}
                  {serie.points.map((point) => {
                    const selected = weekDays[point.index]?.dateIso === selectedDayIso;
                    const size = selected ? 16 : 12;
                    return (
                      <View
                        key={`${serie.key}-dot-${point.index}`}
                        style={[
                          styles.dot,
                          {
                            left: point.x - size / 2,
                            top: point.y - size / 2,
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            borderColor: point.color,
                            backgroundColor: selected ? point.color : appTheme.colors.surface,
                          },
                        ]}
                      />
                    );
                  })}
                </React.Fragment>
              ))
            : null}
          {chartWidth > 0
            ? weekDays.map((day, index) => {
                const stats = calculateDailyMetricStats(day.records, metric);
                const label = formatBarTopLabel(stats, metric);
                const top = topValueFor(stats);
                if (!stats.count || label == null || top == null) {
                  return (
                    <View
                      key={`vacio-${day.dateIso}`}
                      style={[styles.emptyDot, { left: columnX(index) - 4, top: yFor(0) - 4 }]}
                    />
                  );
                }
                return (
                  <Text
                    key={`valor-${day.dateIso}`}
                    numberOfLines={1}
                    // La etiqueta es visual (el valor se lee en la columna accesible y en la tabla);
                    // con letra grande se achica para caber en vez de cortarse con «…».
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                    style={[
                      styles.pointLabel,
                      {
                        left: columnX(index) - columnWidth / 2,
                        width: columnWidth,
                        top: Math.max(0, yFor(heightFor(top)) - 24),
                      },
                      selectedDayIso === day.dateIso && styles.pointLabelSelected,
                    ]}
                  >
                    {label}
                  </Text>
                );
              })
            : null}
        </View>

        {/* Columnas táctiles por día (mínimo 48 dp de ancho). */}
        {weekDays.map((day) => {
          const stats = calculateDailyMetricStats(day.records, metric);
          const hasData = stats.count > 0;
          const count = stats.count;
          const isSelected = selectedDayIso === day.dateIso;

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
              accessibilityState={{ selected: isSelected }}
              onPress={() => setSelectedDayIso(isSelected ? null : day.dateIso)}
              style={[styles.dayColumn, isSelected && styles.dayColumnSelected]}
            >
              <View style={styles.dayFooter}>
                <Text
                  style={[
                    styles.dayLabelText,
                    day.isToday && styles.todayLabelText,
                    isSelected && styles.selectedLabelText,
                  ]}
                >
                  {day.dayLabel}
                </Text>
                <View style={styles.countSlot}>
                  {count > 1 ? (
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText} numberOfLines={1}>
                        ×{count}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
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
      minHeight: 48,
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
    legendLine: {
      width: 18,
      height: 3,
      borderRadius: 2,
    },
    legendDashes: {
      flexDirection: 'row',
      gap: 2,
    },
    legendDash: {
      width: 5,
      height: 3,
      borderRadius: 2,
    },
    legendDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 3,
    },
    legendLabel: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.text,
    },
    chartArea: {
      position: 'relative',
      flexDirection: 'row',
      height: PLOT_TOP + PLOT_HEIGHT + 44,
      // Usa todo el ancho de la tarjeta para que cada día tenga un área táctil amplia.
      marginHorizontal: -theme.spacing.md + 2,
      marginVertical: theme.spacing.sm,
    },
    plotLayer: {
      // Por encima del resaltado del día seleccionado; no recibe toques.
      zIndex: 1,
    },
    gridLine: {
      position: 'absolute',
      left: 8,
      right: 8,
      height: 1,
      backgroundColor: colors.border,
      opacity: 0.7,
    },
    referenceLine: {
      position: 'absolute',
      left: 8,
      right: 8,
      borderTopWidth: 1.5,
      borderStyle: 'dashed',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingRight: 2,
    },
    referenceLineLabel: {
      fontSize: 10,
      fontWeight: '700',
      marginTop: -15,
    },
    dot: {
      position: 'absolute',
      borderWidth: 3,
    },
    emptyDot: {
      position: 'absolute',
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.inputBorder,
      opacity: 0.6,
    },
    pointLabel: {
      position: 'absolute',
      fontSize: 11,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    pointLabelSelected: {
      color: colors.primary,
      fontWeight: '800',
    },
    dayColumn: {
      flex: 1,
      // 7 columnas de 48 no caben en teléfonos de 360 dp (Redmi 13C) y «Hoy» quedaba fuera de la
      // tarjeta; 44 dp sigue cumpliendo el tamaño de objetivo táctil de WCAG 2.5.5.
      minWidth: 44,
      height: '100%',
      justifyContent: 'flex-end',
      alignItems: 'center',
      borderRadius: theme.radius.sm,
    },
    dayColumnSelected: {
      backgroundColor: colors.primaryContainer,
    },
    dayFooter: {
      height: 44,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: 4,
      gap: 2,
    },
    countSlot: {
      height: 16,
      justifyContent: 'center',
    },
    countBadge: {
      backgroundColor: colors.primaryContainer,
      borderRadius: 8,
      paddingHorizontal: 6,
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
      minHeight: 48,
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
