import type { GatewayConfiguracionRecordatorio, GatewayRecordatorio } from './own-gateway.js';

export const AGENDA_TIMEZONE = 'America/Santiago' as const;
export const AGENDA_POLICY = {
  canal: 'push_con_respaldo_local',
  respaldo_segundos: 120,
  ventana_tardia_segundos: 600,
  horizonte_local_dias: 14,
  maximo_avisos_locales: 64,
} as const;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: AGENDA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
function civil(instant: number): string {
  if (!Number.isFinite(instant)) throw new Error('Instante inválido.');
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${parts.year!.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
export function agendaDate(instant: string | number): string {
  return civil(typeof instant === 'number' ? instant : Date.parse(instant)).slice(0, 10);
}
export function validCivilDate(date: string): boolean {
  const value = Date.parse(date + 'T00:00:00Z');
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date >= '0001-01-01' &&
    Number.isFinite(value) &&
    new Date(value).toISOString().slice(0, 10) === date
  );
}
export function shiftAgendaDate(date: string, days: number): string {
  if (!validCivilDate(date) || !Number.isInteger(days)) throw new Error('Fecha inválida.');
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
const offsetsByDay = new Map<string, number[]>();
function offsets(date: string): number[] {
  const cached = offsetsByDay.get(date);
  if (cached) return cached;
  const base = Date.parse(date + 'T12:00:00Z'),
    found = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 6) {
    const instant = base + hour * 3600000;
    found.add(Date.parse(civil(instant) + 'Z') - instant);
  }
  const result = [...found];
  offsetsByDay.set(date, result);
  if (offsetsByDay.size > 64) offsetsByDay.delete(offsetsByDay.keys().next().value!);
  return result;
}
/** Hora ambigua: primer instante. Hora inexistente: primer minuto civil válido posterior. */
export function agendaInstant(date: string, time: string): string {
  if (!validCivilDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('Fecha u hora civil inválida.');
  const target = Date.parse(`${date}T${time}:00Z`),
    candidates = offsets(date);
  for (let minute = 0; minute <= 1440; minute++) {
    const requested = target + minute * 60000;
    const label = new Date(requested).toISOString().slice(0, 19);
    const matches = candidates
      .map((offset) => requested - offset)
      .filter((value) => civil(value) === label);
    if (matches.length) return new Date(Math.min(...matches)).toISOString();
  }
  throw new Error('No hay un instante válido para esa fecha civil.');
}
export function validMedicationReference(value: {
  tipo: string;
  medicamento_paciente_id?: unknown;
}): boolean {
  const id = value.medicamento_paciente_id;
  return (
    id === undefined ||
    id === null ||
    (value.tipo === 'medicacion' &&
      typeof id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  );
}
/** Optional activo defaults to true in the upstream medication response. Dates are inclusive civil dates. */
export function medicationAvailable(
  medication: { activo?: boolean; fecha_inicio?: string | null; fecha_termino?: string | null },
  date: string,
): boolean {
  const start = medication.fecha_inicio,
    end = medication.fecha_termino;
  return (
    validCivilDate(date) &&
    medication.activo !== false &&
    (!start || (validCivilDate(start) && start <= date)) &&
    (!end || (validCivilDate(end) && end >= date))
  );
}
export function normalizedReminder(
  config: GatewayConfiguracionRecordatorio,
): GatewayConfiguracionRecordatorio {
  return {
    tipo: config.tipo,
    titulo: config.titulo,
    zona_horaria: config.zona_horaria,
    horas: [...config.horas].sort(),
    dias_semana: [...config.dias_semana].sort((a, b) => a - b),
    fecha_inicio: config.fecha_inicio,
    fecha_fin: config.fecha_fin,
    activo: config.activo,
    ...(config.medicamento_paciente_id
      ? { medicamento_paciente_id: config.medicamento_paciente_id.toLowerCase() }
      : {}),
  };
}
export function validReminderDates(config: GatewayConfiguracionRecordatorio): boolean {
  return (
    validCivilDate(config.fecha_inicio) &&
    (config.fecha_fin === null ||
      (validCivilDate(config.fecha_fin) && config.fecha_fin >= config.fecha_inicio))
  );
}
export interface AgendaOccurrence {
  ocurrencia_id: string;
  recordatorio_id: string;
  version_recordatorio: number;
  tipo_registro: GatewayRecordatorio['tipo'];
  fecha_local: string;
  hora_local: string;
  programado_en: string;
  respaldo_en: string;
  vence_en: string;
}
export function reminderOccurrence(
  rule: GatewayRecordatorio,
  date: string,
  time: string,
): AgendaOccurrence | null {
  if (
    !validCivilDate(date) ||
    !rule.activo ||
    !rule.horas.includes(time) ||
    date < rule.fecha_inicio ||
    (rule.fecha_fin !== null && date > rule.fecha_fin) ||
    !rule.dias_semana.includes(new Date(date + 'T00:00:00Z').getUTCDay() || 7)
  )
    return null;
  const nominal = agendaInstant(date, time),
    at = Date.parse(nominal);
  return {
    ocurrencia_id: `${rule.id.toLowerCase()}:${rule.version}:${date}:${time.replace(':', '')}`,
    recordatorio_id: rule.id.toLowerCase(),
    version_recordatorio: rule.version,
    tipo_registro: rule.tipo,
    fecha_local: date,
    hora_local: time,
    programado_en: nominal,
    respaldo_en: new Date(at + 120000).toISOString(),
    vence_en: new Date(at + 600000).toISOString(),
  };
}
export function parseOccurrenceId(value: string) {
  const match =
    /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([1-9]\d*):(\d{4}-\d{2}-\d{2}):((?:[01]\d|2[0-3])[0-5]\d)$/.exec(
      value,
    );
  if (!match || !Number.isSafeInteger(Number(match[2])) || !validCivilDate(match[3]!)) return null;
  return {
    id: match[1]!,
    version: Number(match[2]),
    date: match[3]!,
    time: match[4]!.slice(0, 2) + ':' + match[4]!.slice(2),
  };
}
export function upcomingAgendaOccurrences(
  rules: GatewayRecordatorio[],
  now: string,
  completed: ReadonlySet<string> = new Set(),
) {
  const instant = Date.parse(now),
    today = agendaDate(now),
    all: AgendaOccurrence[] = [];
  const end = Date.parse(agendaInstant(shiftAgendaDate(today, 14), '00:00'));
  for (let day = -1; day < 14; day++) {
    const date = shiftAgendaDate(today, day);
    for (const rule of rules) {
      if (rule.tipo !== 'medicacion' && completed.has(`${rule.tipo}:${date}`)) continue;
      for (const hour of rule.horas) {
        const occurrence = reminderOccurrence(rule, date, hour);
        if (
          occurrence &&
          Date.parse(occurrence.respaldo_en) > instant &&
          Date.parse(occurrence.programado_en) < end
        )
          all.push(occurrence);
      }
    }
  }
  all.sort(
    (a, b) =>
      a.respaldo_en.localeCompare(b.respaldo_en) || a.ocurrencia_id.localeCompare(b.ocurrencia_id),
  );
  return {
    occurrences: all.slice(0, 64),
    total: all.length,
    truncated: Math.max(0, all.length - 64),
    horizonEndsAt: new Date(end).toISOString(),
  };
}
