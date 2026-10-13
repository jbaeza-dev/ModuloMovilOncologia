import {
  generateUuid,
  type ReminderRule,
  type ReminderType,
} from '../../data/local/reminders/reminder-types';

export interface MedicationContext {
  id: string;
  nombre: string;
  fechaInicio: string | null; // YYYY-MM-DD
  fechaFin: string | null; // YYYY-MM-DD
  estadoActivo: boolean;
}

export interface OccurrenceCandidate {
  id: string; // NotificacionId (UUID)
  recordatorioId: string;
  revision: number;
  tipo: ReminderType;
  medicamentoId?: string;
  fechaPrevistaUtc: string; // ISO UTC
  fechaCivilLocal: string; // YYYY-MM-DD
  horaMinutoLocal: string; // HH:mm
}

export interface SchedulerResult {
  totalCalculadas: number;
  seleccionadas: OccurrenceCandidate[];
  truncadas: number;
  cubiertoHastaIso: string | null;
  reglasAfectadas: string[];
}

export interface SchedulerOptions {
  now?: Date;
  zonaHoraria?: string;
  ventanaDias?: number; // Default 14
  limiteTrabajos?: number; // Default 128
  idGenerator?: () => string;
}

/**
 * Devuelve el día de la semana ISO (1 = Lunes, ..., 7 = Domingo) para un año, mes (1-12) y día dados.
 */
function getIsoDayOfWeek(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  return dow === 0 ? 7 : dow;
}

/**
 * Formatea un entero a 2 dígitos.
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Convierte una fecha y hora civil local en una zona horaria dada a su equivalente ISO UTC.
 * Maneja saltos de horario de verano (DST) de manera determinista.
 */
export function civilToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  // Usamos Intl.DateTimeFormat para resolver el offset real de esa zona
  // Probamos un rango de búsqueda para resolver la fecha civil exacta en la zona horaria
  const tentativeUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));

  // Función para obtener componentes civiles en la zona horaria para una fecha UTC dada
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  function getLocalParts(d: Date) {
    const parts = formatter.formatToParts(d);
    let y = 0,
      m = 0,
      dt = 0,
      h = 0,
      min = 0;
    for (const p of parts) {
      if (p.type === 'year') y = parseInt(p.value, 10);
      if (p.type === 'month') m = parseInt(p.value, 10);
      if (p.type === 'day') dt = parseInt(p.value, 10);
      if (p.type === 'hour') {
        const val = parseInt(p.value, 10);
        h = val === 24 ? 0 : val;
      }
      if (p.type === 'minute') min = parseInt(p.value, 10);
    }
    if (y === 0) {
      return {
        y: d.getUTCFullYear(),
        m: d.getUTCMonth() + 1,
        dt: d.getUTCDate(),
        h: d.getUTCHours(),
        min: d.getUTCMinutes(),
      };
    }
    return { y, m, dt, h, min };
  }

  // Iteración de aproximación de offset (máximo 3 pasos)
  let currentEstimate = tentativeUtc.getTime();
  for (let i = 0; i < 3; i++) {
    const local = getLocalParts(new Date(currentEstimate));
    const targetLocalMin = Date.UTC(year, month - 1, day, hour, minute) / 60000;
    const actualLocalMin = Date.UTC(local.y, local.m - 1, local.dt, local.h, local.min) / 60000;
    const diffMin = targetLocalMin - actualLocalMin;
    if (diffMin === 0) break;
    currentEstimate += diffMin * 60000;
  }

  return new Date(currentEstimate).toISOString();
}

/**
 * Planificador puro de ocurrencias.
 * Genera candidatos deterministas dentro del intervalo estricto `now < fechaPrevistaUtc < finDeVentana` (14 días calendario),
 * respetando reglas, medicación, DST y tope de 128 trabajos.
 */
export function calculateOccurrences(
  rules: readonly ReminderRule[],
  medications: readonly MedicationContext[],
  options: SchedulerOptions = {},
): SchedulerResult {
  const now = options.now ?? new Date();
  const timeZone = options.zonaHoraria ?? 'America/Santiago';
  const ventanaDias = options.ventanaDias ?? 14;
  const limiteTrabajos = options.limiteTrabajos ?? 128;
  const newId = options.idGenerator ?? generateUuid;

  const nowIso = now.toISOString();

  // Calcular partes civiles actuales de 'now' en la zona horaria
  const nowPartsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour12: false,
  });
  const parts = nowPartsFormatter.formatToParts(now);
  let nowYear = 0,
    nowMonth = 0,
    nowDay = 0;
  for (const p of parts) {
    if (p.type === 'year') nowYear = parseInt(p.value, 10);
    if (p.type === 'month') nowMonth = parseInt(p.value, 10);
    if (p.type === 'day') nowDay = parseInt(p.value, 10);
  }
  if (nowYear === 0) {
    nowYear = now.getUTCFullYear();
    nowMonth = now.getUTCMonth() + 1;
    nowDay = now.getUTCDate();
  }

  // Mapa de medicamentos para consulta rápida
  const medMap = new Map<string, MedicationContext>();
  for (const med of medications) {
    medMap.set(med.id, med);
  }

  const allCandidates: OccurrenceCandidate[] = [];

  // Iterar los días de calendario desde el día actual hasta el día + ventanaDias
  for (let d = 0; d <= ventanaDias; d++) {
    // Calculamos la fecha civil sumando 'd' días
    const civilDateObj = new Date(Date.UTC(nowYear, nowMonth - 1, nowDay + d));
    const civilYear = civilDateObj.getUTCFullYear();
    const civilMonth = civilDateObj.getUTCMonth() + 1;
    const civilDay = civilDateObj.getUTCDate();
    const civilDateStr = `${civilYear}-${pad2(civilMonth)}-${pad2(civilDay)}`;
    const dayOfWeek = getIsoDayOfWeek(civilYear, civilMonth, civilDay);

    for (const rule of rules) {
      // Regla inactiva o eliminada lógicamente: omitir
      if (!rule.habilitado || rule.eliminadoEl !== null) continue;

      // Verificar que el día de la semana coincide con los configurados en la regla
      if (!rule.diasSemana.includes(dayOfWeek)) continue;

      // Límites civiles de la propia regla
      if (rule.fechaInicio && civilDateStr < rule.fechaInicio) continue;
      if (rule.fechaFin && civilDateStr > rule.fechaFin) continue;

      // Si es medicación, validar estado y límites del medicamento
      if (rule.tipo === 'medicacion') {
        if (!rule.medicamentoId) continue;
        const med = medMap.get(rule.medicamentoId);
        if (!med || !med.estadoActivo) continue;
        if (med.fechaInicio && civilDateStr < med.fechaInicio) continue;
        if (med.fechaFin && civilDateStr > med.fechaFin) continue;
      }

      // Procesar cada hora configurada en la regla
      for (const hm of rule.horasMinutos) {
        const [hStr, mStr] = hm.split(':');
        const hour = parseInt(hStr, 10);
        const minute = parseInt(mStr, 10);

        const targetTz = rule.zonaHoraria || timeZone;
        const scheduledUtcIso = civilToUtcIso(
          civilYear,
          civilMonth,
          civilDay,
          hour,
          minute,
          targetTz,
        );

        // Estricto: now < fechaPrevistaUtc
        if (scheduledUtcIso <= nowIso) continue;

        allCandidates.push({
          id: newId(),
          recordatorioId: rule.id,
          revision: rule.revision,
          tipo: rule.tipo,
          medicamentoId: rule.medicamentoId ?? undefined,
          fechaPrevistaUtc: scheduledUtcIso,
          fechaCivilLocal: civilDateStr,
          horaMinutoLocal: hm,
        });
      }
    }
  }

  // Deduplicación post-normalización para una misma regla en el mismo instante UTC
  const seenRuleTime = new Set<string>();
  const deduplicated: OccurrenceCandidate[] = [];
  for (const cand of allCandidates) {
    const key = `${cand.recordatorioId}:${cand.fechaPrevistaUtc}`;
    if (!seenRuleTime.has(key)) {
      seenRuleTime.add(key);
      deduplicated.push(cand);
    }
  }

  // Ordenamiento global determinista: fechaPrevistaUtc ASC, recordatorioId ASC
  deduplicated.sort((a, b) => {
    const timeCmp = a.fechaPrevistaUtc.localeCompare(b.fechaPrevistaUtc);
    if (timeCmp !== 0) return timeCmp;
    return a.recordatorioId.localeCompare(b.recordatorioId);
  });

  const totalCalculadas = deduplicated.length;

  if (totalCalculadas <= limiteTrabajos) {
    return {
      totalCalculadas,
      seleccionadas: deduplicated,
      truncadas: 0,
      cubiertoHastaIso:
        deduplicated.length > 0 ? deduplicated[deduplicated.length - 1].fechaPrevistaUtc : null,
      reglasAfectadas: [],
    };
  }

  // Truncamiento al límite máximo de 128 trabajos
  const seleccionadas = deduplicated.slice(0, limiteTrabajos);
  const sobrantes = deduplicated.slice(limiteTrabajos);
  const reglasAfectadasSet = new Set<string>();
  for (const s of sobrantes) {
    reglasAfectadasSet.add(s.recordatorioId);
  }

  return {
    totalCalculadas,
    seleccionadas,
    truncadas: totalCalculadas - limiteTrabajos,
    cubiertoHastaIso: seleccionadas[seleccionadas.length - 1].fechaPrevistaUtc,
    reglasAfectadas: Array.from(reglasAfectadasSet),
  };
}
