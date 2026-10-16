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

  const targetMinuteOfDay = hour * 60 + minute;
  let estUtc = Date.UTC(year, month - 1, day, hour, minute);

  // Intentar aproximación iterativa (convergencia rápida para fechas ordinarias)
  let prevDiff: number | null = null;
  for (let i = 0; i < 4; i++) {
    const loc = getLocalParts(new Date(estUtc));
    const dayDiff =
      (Date.UTC(loc.y, loc.m - 1, loc.dt) - Date.UTC(year, month - 1, day)) / 86400000;
    const locMinuteOfDay = dayDiff * 1440 + loc.h * 60 + loc.min;
    const diff = targetMinuteOfDay - locMinuteOfDay;
    if (diff === 0) {
      return new Date(estUtc).toISOString();
    }
    if (prevDiff !== null && Math.abs(diff) === Math.abs(prevDiff) && diff === -prevDiff) {
      // Oscilación detectada: estamos en un salto de horario de verano inexistente (gap)
      break;
    }
    prevDiff = diff;
    estUtc += diff * 60000;
  }

  // Si cayó en un gap inexistente: buscar el primer minuto UTC en ese día donde local >= targetMinuteOfDay
  // (avanza al siguiente minuto válido según la política del plan, ej. 01:00 tras 00:30 inexistente)
  const low = estUtc - 2 * 3600000;
  const high = estUtc + 2 * 3600000;
  let bestUtc: number | null = null;

  for (let t = low; t <= high; t += 60000) {
    const loc = getLocalParts(new Date(t));
    if (loc.y === year && loc.m === month && loc.dt === day) {
      const curMin = loc.h * 60 + loc.min;
      if (curMin === targetMinuteOfDay) {
        return new Date(t).toISOString();
      }
      if (curMin > targetMinuteOfDay) {
        if (bestUtc === null || t < bestUtc) {
          bestUtc = t;
        }
      }
    }
  }

  if (bestUtc !== null) {
    return new Date(bestUtc).toISOString();
  }

  return new Date(estUtc).toISOString();
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
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = nowPartsFormatter.formatToParts(now);
  let nowYear = 0,
    nowMonth = 0,
    nowDay = 0,
    nowHour = 0,
    nowMinute = 0;
  for (const p of parts) {
    if (p.type === 'year') nowYear = parseInt(p.value, 10);
    if (p.type === 'month') nowMonth = parseInt(p.value, 10);
    if (p.type === 'day') nowDay = parseInt(p.value, 10);
    if (p.type === 'hour') nowHour = parseInt(p.value, 10);
    if (p.type === 'minute') nowMinute = parseInt(p.value, 10);
  }
  if (nowYear === 0) {
    nowYear = now.getUTCFullYear();
    nowMonth = now.getUTCMonth() + 1;
    nowDay = now.getUTCDate();
    nowHour = now.getUTCHours();
    nowMinute = now.getUTCMinutes();
  }

  // Calcular explícitamente finDeVentana en la zona horaria correspondiente
  const finDeVentanaIso = civilToUtcIso(
    nowYear,
    nowMonth,
    nowDay + ventanaDias,
    nowHour,
    nowMinute,
    timeZone,
  );

  // Mapa de medicamentos para consulta rápida
  const medMap = new Map<string, MedicationContext>();
  for (const m of medications) {
    medMap.set(m.id, m);
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

        // Estricto: now < fechaPrevistaUtc < finDeVentanaIso
        if (scheduledUtcIso <= nowIso || scheduledUtcIso >= finDeVentanaIso) continue;

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
