import { getCivilPartsInTimeZone } from './reminder-status';

export const DEFAULT_VITAL_TIME = '07:00';
export const ALL_WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const INCLUSIVE_DURATION_PRESETS = [5, 7, 10, 14, 21] as const;

export function getCivilDateInTimeZone(date: Date, timeZone = 'America/Santiago'): string {
  return getCivilPartsInTimeZone(date.toISOString(), timeZone).civilDate;
}

export type MedicationTemplateId = 'morning' | 'twice_daily' | 'three_daily' | 'custom';

export interface MedicationScheduleTemplate {
  id: MedicationTemplateId;
  label: string;
  subtitle: string;
  hours: string[];
}

export const MEDICATION_SCHEDULE_TEMPLATES: readonly MedicationScheduleTemplate[] = [
  {
    id: 'morning',
    label: 'Horario de mañana',
    subtitle: '07:00',
    hours: ['07:00'],
  },
  {
    id: 'twice_daily',
    label: 'Dos horarios diarios',
    subtitle: '07:00 y 19:00',
    hours: ['07:00', '19:00'],
  },
  {
    id: 'three_daily',
    label: 'Tres horarios diarios',
    subtitle: '07:00, 15:00 y 23:00',
    hours: ['07:00', '15:00', '23:00'],
  },
  {
    id: 'custom',
    label: 'Personalizar',
    subtitle: 'Elegir horas, días y vigencia manualmente',
    hours: [],
  },
] as const;

const CIVIL_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_HH_MM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Valida que una cadena sea una fecha civil real YYYY-MM-DD (incluyendo años bisiestos).
 */
export function isValidCivilDate(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  const match = CIVIL_DATE_REGEX.exec(value.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Valida formato de hora 24h HH:mm (00:00 a 23:59).
 */
export function isValidTimeHhMm(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  return TIME_HH_MM_REGEX.test(value.trim());
}

/**
 * Normaliza una fecha civil o timestamp ISO a YYYY-MM-DD válido, o retorna null.
 */
export function extractValidCivilDate(
  raw: string | null | undefined,
  timeZone = 'America/Santiago',
): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (isValidCivilDate(trimmed)) return trimmed;

  const slice10 = trimmed.slice(0, 10);
  if (isValidCivilDate(slice10) && trimmed.length === 10) {
    return slice10;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return getCivilDateInTimeZone(parsed, timeZone);
}

/**
 * Suma `daysToAdd` días civiles a una fecha YYYY-MM-DD válida.
 */
export function addCivilDays(civilDate: string, daysToAdd: number): string {
  if (!isValidCivilDate(civilDate)) {
    throw new Error(`Fecha de inicio inválida: ${civilDate}`);
  }
  if (!Number.isInteger(daysToAdd)) {
    throw new Error(`Cantidad de días inválida: ${daysToAdd}`);
  }

  const [y, m, d] = civilDate.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + daysToAdd));
  const year = String(next.getUTCFullYear()).padStart(4, '0');
  const month = String(next.getUTCMonth() + 1).padStart(2, '0');
  const day = String(next.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calcula la fecha de término inclusiva para una duración en días:
 * fechaFin = addCivilDays(fechaInicio, cantidadDias - 1).
 */
export function calculateInclusiveEndDate(fechaInicio: string, cantidadDias: number): string {
  if (!Number.isInteger(cantidadDias) || cantidadDias < 1) {
    throw new Error('La duración en días debe ser un número entero mayor o igual a 1.');
  }
  return addCivilDays(fechaInicio, cantidadDias - 1);
}

/**
 * Calcula la cantidad de días civiles inclusivos entre fechaInicio y fechaFin.
 * Retorna null si alguna fecha es inválida o si fechaFin < fechaInicio.
 */
export function getInclusiveDaysBetween(
  fechaInicio: string | null | undefined,
  fechaFin: string | null | undefined,
): number | null {
  if (!isValidCivilDate(fechaInicio) || !isValidCivilDate(fechaFin)) return null;
  if (fechaFin < fechaInicio) return null;

  const [y1, m1, d1] = fechaInicio.split('-').map(Number);
  const [y2, m2, d2] = fechaFin.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  const diffDays = Math.round((utc2 - utc1) / 86_400_000);
  return diffDays + 1;
}

export interface MedicationDateBounds {
  minDate: string | null;
  maxDate: string | null;
  defaultStartDate: string;
  defaultEndDate: string | null;
}

/**
 * Determina las cotas civiles de vigencia a partir de un medicamento del catálogo.
 */
export function resolveMedicationDateBounds(
  medication: { fecha_inicio?: string | null; fecha_fin?: string | null } | null | undefined,
  todayCivilDate: string,
  timeZone = 'America/Santiago',
): MedicationDateBounds {
  const safeToday = isValidCivilDate(todayCivilDate) ? todayCivilDate : '2026-01-01';
  const minDate = extractValidCivilDate(medication?.fecha_inicio, timeZone);
  const maxDate = extractValidCivilDate(medication?.fecha_fin, timeZone);

  let defaultStartDate = safeToday;
  if (minDate && minDate > defaultStartDate) {
    defaultStartDate = minDate;
  }
  if (maxDate && defaultStartDate > maxDate) {
    defaultStartDate = minDate && minDate <= maxDate ? minDate : maxDate;
  }

  return {
    minDate,
    maxDate,
    defaultStartDate,
    defaultEndDate: maxDate && maxDate >= defaultStartDate ? maxDate : null,
  };
}

/**
 * Aplica una duración inclusiva en días respetando el límite superior del medicamento si existe.
 */
export function applyInclusiveDurationWithBounds(
  fechaInicio: string,
  cantidadDias: number,
  bounds?: Pick<MedicationDateBounds, 'maxDate'> | null,
): { fechaFin: string; clampedToMedicationEnd: boolean } {
  const rawEnd = calculateInclusiveEndDate(fechaInicio, cantidadDias);
  if (bounds?.maxDate && isValidCivilDate(bounds.maxDate) && rawEnd > bounds.maxDate) {
    return {
      fechaFin: bounds.maxDate,
      clampedToMedicationEnd: true,
    };
  }
  return {
    fechaFin: rawEnd,
    clampedToMedicationEnd: false,
  };
}

/**
 * Valida un rango de fechas civiles opcionales (fechaInicio, fechaFin) y cotas opcionales.
 * Retorna null si es válido o un mensaje de error en español.
 */
export function validateReminderDateRange(
  fechaInicio: string | null | undefined,
  fechaFin: string | null | undefined,
  bounds?: Pick<MedicationDateBounds, 'minDate' | 'maxDate'> | null,
): string | null {
  const hasStart = fechaInicio !== null && fechaInicio !== undefined && fechaInicio.trim() !== '';
  const hasEnd = fechaFin !== null && fechaFin !== undefined && fechaFin.trim() !== '';

  if (hasStart && !isValidCivilDate(fechaInicio)) {
    return 'La fecha de inicio no es válida. Usa el formato AAAA-MM-DD con una fecha real.';
  }
  if (hasEnd && !isValidCivilDate(fechaFin)) {
    return 'La fecha de término no es válida. Usa el formato AAAA-MM-DD con una fecha real.';
  }

  if (hasStart && hasEnd && fechaFin! < fechaInicio!) {
    return 'La fecha de término no puede ser anterior a la fecha de inicio.';
  }

  if (hasStart && bounds?.minDate && isValidCivilDate(bounds.minDate)) {
    if (fechaInicio! < bounds.minDate) {
      return `La fecha de inicio no puede ser anterior al inicio del tratamiento (${bounds.minDate}).`;
    }
  }

  if (hasEnd && bounds?.maxDate && isValidCivilDate(bounds.maxDate)) {
    if (fechaFin! > bounds.maxDate) {
      return `La fecha de término no puede superar el fin del tratamiento (${bounds.maxDate}).`;
    }
  }

  return null;
}

/**
 * Detecta a qué plantilla rápida corresponden las horas y días seleccionados.
 */
export function detectMedicationTemplate(
  hours: string[],
  days: number[],
  hasCustomDates: boolean,
): MedicationTemplateId {
  if (hasCustomDates) return 'custom';
  const sortedDays = [...days].sort((a, b) => a - b);
  const isAllDays = sortedDays.length === 7 && sortedDays.every((d, index) => d === index + 1);
  if (!isAllDays) return 'custom';

  const sortedHours = [...hours].sort();
  if (sortedHours.length === 1 && sortedHours[0] === '07:00') {
    return 'morning';
  }
  if (sortedHours.length === 2 && sortedHours[0] === '07:00' && sortedHours[1] === '19:00') {
    return 'twice_daily';
  }
  if (
    sortedHours.length === 3 &&
    sortedHours[0] === '07:00' &&
    sortedHours[1] === '15:00' &&
    sortedHours[2] === '23:00'
  ) {
    return 'three_daily';
  }
  return 'custom';
}
