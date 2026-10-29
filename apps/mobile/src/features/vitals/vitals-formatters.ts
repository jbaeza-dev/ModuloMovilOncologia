import { clinicalStatusLabel } from '../../data/sync/visible-status';
import type { VitalRecord, VitalWithSyncRecord } from '../../data/local/repository';
import {
  formatCivilDateDisplay,
  getCivilPartsInTimeZone,
} from '../../services/reminders/reminder-status';

const DEFAULT_TIMEZONE = 'America/Santiago';

export function formatTemperature(value: number): string {
  // En es-CL se usa coma decimal: 36.8 -> "36,8"
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatVitalsSummary(
  record: Pick<
    VitalRecord,
    'temperatura' | 'presion_sistolica' | 'presion_diastolica' | 'pulso' | 'saturacion_o2'
  >,
): string {
  const parts: string[] = [];

  if (record.presion_sistolica !== null && record.presion_diastolica !== null) {
    parts.push(`Presión: ${record.presion_sistolica}/${record.presion_diastolica} mmHg`);
  } else if (record.presion_sistolica !== null) {
    parts.push(`Presión sistólica: ${record.presion_sistolica} mmHg`);
  } else if (record.presion_diastolica !== null) {
    parts.push(`Presión diastólica: ${record.presion_diastolica} mmHg`);
  }

  if (record.temperatura !== null) {
    parts.push(`Temperatura: ${formatTemperature(record.temperatura)} °C`);
  }

  if (record.pulso !== null) {
    parts.push(`Pulso: ${record.pulso} latidos/min`);
  }

  if (record.saturacion_o2 !== null) {
    parts.push(`Saturación: ${record.saturacion_o2} %`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Sin mediciones registradas';
}

export function formatRecordTime(isoUtc: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = getCivilPartsInTimeZone(isoUtc, timeZone);
  return parts.hourMinute;
}

export function getRecordCivilDate(isoUtc: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = getCivilPartsInTimeZone(isoUtc, timeZone);
  return parts.civilDate;
}

export function getDaySectionTitle(
  civilDate: string,
  nowIso: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const todayParts = getCivilPartsInTimeZone(nowIso, timeZone);
  const todayDate = todayParts.civilDate;

  // Calcular el día civil anterior mediante aritmética de calendario en UTC (inmune a DST y transiciones horarias)
  const [yearStr, monthStr, dayStr] = todayDate.split('-');
  const y = Number(yearStr);
  const m = Number(monthStr);
  const d = Number(dayStr);
  const prevDate = new Date(Date.UTC(y, m - 1, d - 1));
  const prevYear = prevDate.getUTCFullYear();
  const prevMonth = String(prevDate.getUTCMonth() + 1).padStart(2, '0');
  const prevDay = String(prevDate.getUTCDate()).padStart(2, '0');
  const yesterdayDate = `${prevYear}-${prevMonth}-${prevDay}`;

  if (civilDate === todayDate) {
    return 'Hoy';
  }
  if (civilDate === yesterdayDate) {
    return 'Ayer';
  }
  return formatCivilDateDisplay(civilDate);
}

export function getSyncStatusLabel(
  record: Pick<VitalWithSyncRecord, 'estado_envio' | 'gestor_envio'>,
): string {
  if (
    record.estado_envio &&
    ['guardado_local', 'pausado', 'aceptado', 'rechazado'].includes(record.estado_envio)
  )
    return clinicalStatusLabel(record.estado_envio);
  if (record.estado_envio === 'pendiente' && record.gestor_envio === 'powersync')
    return clinicalStatusLabel(record.estado_envio);
  if (record.estado_envio === 'pendiente' || !record.estado_envio) {
    return 'Guardado en este dispositivo';
  }
  return `Estado: ${record.estado_envio}`;
}

export interface VitalDaySection {
  date: string;
  title: string;
  data: VitalWithSyncRecord[];
}

export function groupVitalsByDay(
  records: VitalWithSyncRecord[],
  nowIso: string,
  timeZone: string = DEFAULT_TIMEZONE,
): VitalDaySection[] {
  // Deduplicar registros por ID preservando el primero observado
  const seenIds = new Set<string>();
  const uniqueRecords: VitalWithSyncRecord[] = [];
  for (const r of records) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id);
      uniqueRecords.push(r);
    }
  }

  // Agrupar por civilDate
  const map = new Map<string, VitalWithSyncRecord[]>();
  for (const record of uniqueRecords) {
    const cDate = getRecordCivilDate(record.fecha_registro, timeZone);
    const existing = map.get(cDate);
    if (existing) {
      existing.push(record);
    } else {
      map.set(cDate, [record]);
    }
  }

  // Ordenar fechas civiles descendente (más recientes primero)
  const sortedDates = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));

  const sections: VitalDaySection[] = [];
  for (const date of sortedDates) {
    const items = map.get(date) ?? [];
    // Ordenar elementos del día: más reciente primero, con desempate estable por ID
    items.sort((a, b) => {
      const cmp = b.fecha_registro.localeCompare(a.fecha_registro);
      if (cmp !== 0) return cmp;
      return b.id.localeCompare(a.id);
    });

    sections.push({
      date,
      title: getDaySectionTitle(date, nowIso, timeZone),
      data: items,
    });
  }

  return sections;
}

export function formatVitalCardAccessibilityLabel(
  record: VitalWithSyncRecord,
  nowIso: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const cDate = getRecordCivilDate(record.fecha_registro, timeZone);
  const dayTitle = getDaySectionTitle(cDate, nowIso, timeZone);
  const time = formatRecordTime(record.fecha_registro, timeZone);
  const summary = formatVitalsSummary(record);
  const sync = getSyncStatusLabel(record);

  return `${dayTitle} a las ${time}. ${summary}. ${sync}. Toca para abrir detalle del registro.`;
}
