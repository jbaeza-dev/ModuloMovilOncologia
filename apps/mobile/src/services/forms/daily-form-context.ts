export const DEFAULT_FORMS_TIMEZONE = 'America/Santiago';

export interface DailyFormContext {
  fechaSeguimiento: string; // YYYY-MM-DD en hora civil
  periodoClave: string; // dia:YYYY-MM-DD
  zonaHoraria: string;
  iniciadoEn: string; // ISO UTC
  ventanaDesde: string; // ISO UTC (ventana de recuerdo de 24 horas)
  ventanaHasta: string; // ISO UTC
}

const CIVIL_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Obtiene la fecha civil (YYYY-MM-DD) para un instante dado en la zona horaria especificada.
 * Utiliza Intl.DateTimeFormat para garantizar precisión ante transiciones de horario de verano (DST).
 */
export function getCivilDateInTimeZone(
  dateInput: Date | string = new Date(),
  timeZone: string = DEFAULT_FORMS_TIMEZONE,
): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) {
    throw new Error(`Fecha inválida suministrada: ${String(dateInput)}`);
  }

  let targetTz = timeZone || DEFAULT_FORMS_TIMEZONE;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: targetTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  } catch {
    targetTz = DEFAULT_FORMS_TIMEZONE;
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: targetTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  }

  let year = '';
  let month = '';
  let day = '';

  for (const p of parts) {
    if (p.type === 'year') year = p.value;
    if (p.type === 'month') month = p.value.padStart(2, '0');
    if (p.type === 'day') day = p.value.padStart(2, '0');
  }

  return `${year}-${month}-${day}`;
}

/**
 * Formatea la clave canónica del período diario para una fecha civil.
 * Ejemplo: '2026-10-18' -> 'dia:2026-10-18'
 */
export function formatDailyPeriodKey(fechaSeguimiento: string): string {
  const trimmed = fechaSeguimiento.trim();
  if (!CIVIL_DATE_REGEX.test(trimmed)) {
    throw new Error(`Fecha de seguimiento inválida para clave de período: '${fechaSeguimiento}'`);
  }
  return `dia:${trimmed}`;
}

/**
 * Parsea una clave de período diario. Si no cumple con el formato 'dia:YYYY-MM-DD', retorna null.
 */
export function parseDailyPeriodKey(periodoClave: string): { fechaSeguimiento: string } | null {
  if (!periodoClave || typeof periodoClave !== 'string') return null;
  const trimmed = periodoClave.trim();
  if (!trimmed.startsWith('dia:')) return null;
  const fechaSeguimiento = trimmed.slice(4);
  if (!CIVIL_DATE_REGEX.test(fechaSeguimiento)) return null;
  return { fechaSeguimiento };
}

/**
 * Genera el contexto temporal canónico de un nuevo seguimiento diario.
 * Establece la fecha civil en America/Santiago y la ventana de recuerdo de 24 horas exactas.
 */
export function createDailyFormContext(options?: {
  now?: Date | string;
  timeZone?: string;
}): DailyFormContext {
  const now = options?.now
    ? typeof options.now === 'string'
      ? new Date(options.now)
      : options.now
    : new Date();

  if (isNaN(now.getTime())) {
    throw new Error(`Fecha inválida suministrada para contexto diario: ${String(options?.now)}`);
  }

  const timeZone = options?.timeZone || DEFAULT_FORMS_TIMEZONE;
  const fechaSeguimiento = getCivilDateInTimeZone(now, timeZone);
  const periodoClave = formatDailyPeriodKey(fechaSeguimiento);
  const iniciadoEn = now.toISOString();

  // Ventana de recuerdo de 24 horas previas al inicio
  const ventanaDesde = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const ventanaHasta = iniciadoEn;

  return {
    fechaSeguimiento,
    periodoClave,
    zonaHoraria: timeZone,
    iniciadoEn,
    ventanaDesde,
    ventanaHasta,
  };
}

/**
 * Verifica si un período clave coincide con la fecha civil actual en la zona horaria del usuario.
 */
export function isDailyPeriodCurrent(
  periodoClave: string,
  nowInput: Date | string = new Date(),
  timeZone: string = DEFAULT_FORMS_TIMEZONE,
): boolean {
  const parsed = parseDailyPeriodKey(periodoClave);
  if (!parsed) return false;
  const today = getCivilDateInTimeZone(nowInput, timeZone);
  return parsed.fechaSeguimiento === today;
}
