import type {
  NotificationItem,
  ReminderRule,
  ReminderStatusSnapshot,
  ReminderType,
} from '../../data/local/reminders/reminder-types';
import type { NotificationPermissionState } from '../notifications/notification-adapter';
import type { CoordinatorResult } from './notification-coordinator';
import { calculateOccurrences, civilToUtcIso } from './occurrence-scheduler';

export type ReminderDomainStatus =
  | 'no_configured'
  | 'rule_disabled'
  | 'preferences_disabled'
  | 'scheduled'
  | 'pending_scheduling'
  | 'no_upcoming'
  | 'scheduling_failed'
  | 'query_error';

export type ReminderDeviceAvailability =
  | 'available'
  | 'permission_required'
  | 'permission_blocked'
  | 'channel_blocked';

export type NoUpcomingReason = 'ended' | 'starts_after_window' | 'no_matching_days';

export interface ReminderStatusEvaluation {
  status: ReminderDomainStatus;
  deviceAvailability: ReminderDeviceAvailability;
  ruleId: string | null;
  rulesCount: number;
  enabledRulesCount: number;
  allEnabledRulesCount: number;
  otherEnabledRulesCount: number;
  notificationId: string | null;
  fechaPrevistaUtc: string | null;
  fechaCivilLocal: string | null;
  horaMinutoLocal: string | null;
  zonaHoraria: string | null;
  noUpcomingReason: NoUpcomingReason | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  cubiertoHastaIso: string | null;
  truncadas: number;
}

export interface ClassifyReminderStatusOptions {
  tipo?: ReminderType;
  medicamentoId?: string | null;
  ruleId?: string | null;
  permissionState?: NotificationPermissionState | null;
  coordinatorResult?: CoordinatorResult | null;
  coordinatorInFlight?: boolean;
  ventanaDias?: number;
}

const DEFAULT_TIMEZONE = 'America/Santiago';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function getCivilPartsInTimeZone(
  utcIso: string,
  timeZone: string = DEFAULT_TIMEZONE,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  civilDate: string;
  hourMinute: string;
} {
  const date = new Date(utcIso);
  let targetTz = timeZone || DEFAULT_TIMEZONE;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: targetTz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date);
  } catch {
    targetTz = DEFAULT_TIMEZONE;
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: targetTz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date);
  }

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;

  for (const p of parts) {
    if (p.type === 'year') year = parseInt(p.value, 10);
    if (p.type === 'month') month = parseInt(p.value, 10);
    if (p.type === 'day') day = parseInt(p.value, 10);
    if (p.type === 'hour') {
      const val = parseInt(p.value, 10);
      hour = val === 24 ? 0 : val;
    }
    if (p.type === 'minute') minute = parseInt(p.value, 10);
  }

  if (year === 0) {
    year = date.getUTCFullYear();
    month = date.getUTCMonth() + 1;
    day = date.getUTCDate();
    hour = date.getUTCHours();
    minute = date.getUTCMinutes();
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    civilDate: `${year}-${pad2(month)}-${pad2(day)}`,
    hourMinute: `${pad2(hour)}:${pad2(minute)}`,
  };
}

function addDaysToCivilDate(civilDate: string, days: number): string {
  const [yStr, mStr, dStr] = civilDate.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function maxCivilDate(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a && b) return a >= b ? a : b;
  return a ?? b ?? null;
}

function minCivilDate(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a && b) return a <= b ? a : b;
  return a ?? b ?? null;
}

export function resolveDeviceAvailability(
  permissionState?: NotificationPermissionState | null,
  coordinatorResult?: CoordinatorResult | null,
): ReminderDeviceAvailability {
  const effectivePermission = permissionState ?? coordinatorResult?.permission ?? null;
  if (!effectivePermission) {
    if (coordinatorResult?.status === 'permiso_denegado') {
      return 'permission_blocked';
    }
    return 'available';
  }

  if (effectivePermission.channelStatus === 'blocked') {
    return 'channel_blocked';
  }

  if (effectivePermission.status !== 'granted') {
    return effectivePermission.canAskAgain ? 'permission_required' : 'permission_blocked';
  }

  return 'available';
}

function classifySingleRuleNoUpcoming(
  rule: ReminderRule,
  nowIso: string,
  ventanaDias: number,
  medicationsMap: ReadonlyMap<
    string,
    { fechaInicio: string | null; fechaFin: string | null; estadoActivo: boolean }
  >,
): {
  reason: NoUpcomingReason;
  fechaInicio: string | null;
  fechaFin: string | null;
} {
  const tz = rule.zonaHoraria || DEFAULT_TIMEZONE;
  const nowParts = getCivilPartsInTimeZone(nowIso, tz);
  const todayCivil = nowParts.civilDate;
  const windowEndCivil = addDaysToCivilDate(todayCivil, ventanaDias);
  const finDeVentanaIso = civilToUtcIso(
    nowParts.year,
    nowParts.month,
    nowParts.day + ventanaDias,
    nowParts.hour,
    nowParts.minute,
    tz,
  );

  let effectiveStart = rule.fechaInicio;
  let effectiveEnd = rule.fechaFin;

  if (rule.tipo === 'medicacion') {
    const med = rule.medicamentoId ? medicationsMap.get(rule.medicamentoId) : undefined;
    if (!med || !med.estadoActivo) {
      return {
        reason: 'ended',
        fechaInicio: rule.fechaInicio,
        fechaFin: rule.fechaFin,
      };
    }
    effectiveStart = maxCivilDate(rule.fechaInicio, med.fechaInicio);
    effectiveEnd = minCivilDate(rule.fechaFin, med.fechaFin);
  }

  if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
    return {
      reason: 'ended',
      fechaInicio: effectiveStart,
      fechaFin: effectiveEnd,
    };
  }

  if (effectiveEnd) {
    if (effectiveEnd < todayCivil) {
      return {
        reason: 'ended',
        fechaInicio: effectiveStart,
        fechaFin: effectiveEnd,
      };
    }
    if (effectiveEnd === todayCivil) {
      const [ey, em, ed] = effectiveEnd.split('-').map((v) => parseInt(v, 10));
      const hasFutureToday = rule.horasMinutos.some((hm) => {
        const [h, m] = hm.split(':').map((v) => parseInt(v, 10));
        const occIso = civilToUtcIso(ey, em, ed, h, m, tz);
        return occIso > nowIso;
      });
      if (!hasFutureToday) {
        return {
          reason: 'ended',
          fechaInicio: effectiveStart,
          fechaFin: effectiveEnd,
        };
      }
    }
  }

  if (effectiveStart) {
    if (effectiveStart > windowEndCivil) {
      return {
        reason: 'starts_after_window',
        fechaInicio: effectiveStart,
        fechaFin: effectiveEnd,
      };
    }
    if (effectiveStart === windowEndCivil) {
      const [sy, sm, sd] = effectiveStart.split('-').map((v) => parseInt(v, 10));
      const allAtOrAfterWindowEnd = rule.horasMinutos.every((hm) => {
        const [h, m] = hm.split(':').map((v) => parseInt(v, 10));
        const occIso = civilToUtcIso(sy, sm, sd, h, m, tz);
        return occIso >= finDeVentanaIso;
      });
      if (allAtOrAfterWindowEnd) {
        return {
          reason: 'starts_after_window',
          fechaInicio: effectiveStart,
          fechaFin: effectiveEnd,
        };
      }
    }
  }

  return {
    reason: 'no_matching_days',
    fechaInicio: effectiveStart,
    fechaFin: effectiveEnd,
  };
}

export function createQueryErrorReminderStatus(): ReminderStatusEvaluation {
  return {
    status: 'query_error',
    deviceAvailability: 'available',
    ruleId: null,
    rulesCount: 0,
    enabledRulesCount: 0,
    allEnabledRulesCount: 0,
    otherEnabledRulesCount: 0,
    notificationId: null,
    fechaPrevistaUtc: null,
    fechaCivilLocal: null,
    horaMinutoLocal: null,
    zonaHoraria: null,
    noUpcomingReason: null,
    fechaInicio: null,
    fechaFin: null,
    cubiertoHastaIso: null,
    truncadas: 0,
  };
}

/**
 * Clasifica de manera pura y determinista el estado de los recordatorios
 * a partir de una instantánea consistente de SQLite y el estado opcional de coordinación/permisos.
 */
export function classifyReminderStatus(
  snapshot: ReminderStatusSnapshot,
  options: ClassifyReminderStatusOptions = {},
): ReminderStatusEvaluation {
  const targetTipo = options.tipo ?? 'registro_vitales';
  const ventanaDias = options.ventanaDias ?? 14;
  const deviceAvailability = resolveDeviceAvailability(
    options.permissionState,
    options.coordinatorResult,
  );

  // Reglas válidas del paciente activo sin baja lógica, con orden estable por creado_el ASC, id ASC
  const patientRules = snapshot.rules
    .filter((r) => r.pacienteId === snapshot.patientId && r.eliminadoEl === null)
    .slice()
    .sort((a, b) => {
      const createdCmp = a.creadoEl.localeCompare(b.creadoEl);
      if (createdCmp !== 0) return createdCmp;
      return a.id.localeCompare(b.id);
    });

  const allEnabledRulesCount = patientRules.filter((r) => r.habilitado).length;

  const targetRules = patientRules.filter((r) => {
    if (options.ruleId) {
      return r.id === options.ruleId;
    }
    if (r.tipo !== targetTipo) return false;
    if (options.medicamentoId !== undefined && options.medicamentoId !== null) {
      return r.medicamentoId === options.medicamentoId;
    }
    return true;
  });

  // 2. Sin reglas: no_configured, aunque las preferencias generales estén apagadas
  if (targetRules.length === 0) {
    return {
      status: 'no_configured',
      deviceAvailability,
      ruleId: null,
      rulesCount: 0,
      enabledRulesCount: 0,
      allEnabledRulesCount,
      otherEnabledRulesCount: allEnabledRulesCount,
      notificationId: null,
      fechaPrevistaUtc: null,
      fechaCivilLocal: null,
      horaMinutoLocal: null,
      zonaHoraria: null,
      noUpcomingReason: null,
      fechaInicio: null,
      fechaFin: null,
      cubiertoHastaIso: null,
      truncadas: 0,
    };
  }

  const enabledRules = targetRules.filter((r) => r.habilitado);
  const otherEnabledRulesCount = Math.max(0, allEnabledRulesCount - enabledRules.length);

  // 3. Sin reglas habilitadas: rule_disabled
  if (enabledRules.length === 0) {
    const primaryRule = targetRules[0];
    return {
      status: 'rule_disabled',
      deviceAvailability,
      ruleId: primaryRule.id,
      rulesCount: targetRules.length,
      enabledRulesCount: 0,
      allEnabledRulesCount,
      otherEnabledRulesCount,
      notificationId: null,
      fechaPrevistaUtc: null,
      fechaCivilLocal: null,
      horaMinutoLocal: null,
      zonaHoraria: primaryRule.zonaHoraria || DEFAULT_TIMEZONE,
      noUpcomingReason: null,
      fechaInicio: primaryRule.fechaInicio,
      fechaFin: primaryRule.fechaFin,
      cubiertoHastaIso: null,
      truncadas: 0,
    };
  }

  // 4. Con reglas habilitadas y preferencia general apagada: preferences_disabled
  if (!snapshot.preferences.enabled) {
    const primaryEnabled = enabledRules[0];
    return {
      status: 'preferences_disabled',
      deviceAvailability,
      ruleId: primaryEnabled.id,
      rulesCount: targetRules.length,
      enabledRulesCount: enabledRules.length,
      allEnabledRulesCount,
      otherEnabledRulesCount,
      notificationId: null,
      fechaPrevistaUtc: null,
      fechaCivilLocal: null,
      horaMinutoLocal: null,
      zonaHoraria: primaryEnabled.zonaHoraria || DEFAULT_TIMEZONE,
      noUpcomingReason: null,
      fechaInicio: primaryEnabled.fechaInicio,
      fechaFin: primaryEnabled.fechaFin,
      cubiertoHastaIso: null,
      truncadas: 0,
    };
  }

  // 5. Calcular ocurrencias elegibles con el programador existente y su ventana
  const primaryTimeZone = enabledRules[0]?.zonaHoraria || DEFAULT_TIMEZONE;
  const plan = calculateOccurrences(enabledRules, snapshot.medications, {
    now: new Date(snapshot.nowIso),
    zonaHoraria: primaryTimeZone,
    ventanaDias,
  });

  const eligibleOccurrences = plan.seleccionadas;

  // 12 & 13. Si no existen ocurrencias elegibles en la ventana: no_upcoming (sobre el conjunto de reglas habilitadas)
  if (eligibleOccurrences.length === 0) {
    const medMap = new Map(
      snapshot.medications.map((m) => [
        m.id,
        { fechaInicio: m.fechaInicio, fechaFin: m.fechaFin, estadoActivo: m.estadoActivo },
      ]),
    );

    const perRule = enabledRules.map((rule) => ({
      rule,
      ...classifySingleRuleNoUpcoming(rule, snapshot.nowIso, ventanaDias, medMap),
    }));

    // Prioridad sobre el conjunto: starts_after_window > no_matching_days > ended
    const startsLater = perRule
      .filter((item) => item.reason === 'starts_after_window')
      .sort((a, b) => (a.fechaInicio ?? '').localeCompare(b.fechaInicio ?? ''));

    if (startsLater.length > 0) {
      const chosen = startsLater[0];
      return {
        status: 'no_upcoming',
        deviceAvailability,
        ruleId: chosen.rule.id,
        rulesCount: targetRules.length,
        enabledRulesCount: enabledRules.length,
        allEnabledRulesCount,
        otherEnabledRulesCount,
        notificationId: null,
        fechaPrevistaUtc: null,
        fechaCivilLocal: null,
        horaMinutoLocal: null,
        zonaHoraria: chosen.rule.zonaHoraria || DEFAULT_TIMEZONE,
        noUpcomingReason: 'starts_after_window',
        fechaInicio: chosen.fechaInicio,
        fechaFin: chosen.fechaFin,
        cubiertoHastaIso: null,
        truncadas: plan.truncadas,
      };
    }

    const noMatchingDays = perRule.filter((item) => item.reason === 'no_matching_days');
    if (noMatchingDays.length > 0) {
      const chosen = noMatchingDays[0];
      return {
        status: 'no_upcoming',
        deviceAvailability,
        ruleId: chosen.rule.id,
        rulesCount: targetRules.length,
        enabledRulesCount: enabledRules.length,
        allEnabledRulesCount,
        otherEnabledRulesCount,
        notificationId: null,
        fechaPrevistaUtc: null,
        fechaCivilLocal: null,
        horaMinutoLocal: null,
        zonaHoraria: chosen.rule.zonaHoraria || DEFAULT_TIMEZONE,
        noUpcomingReason: 'no_matching_days',
        fechaInicio: chosen.fechaInicio,
        fechaFin: chosen.fechaFin,
        cubiertoHastaIso: null,
        truncadas: plan.truncadas,
      };
    }

    const endedSorted = perRule
      .slice()
      .sort((a, b) => (b.fechaFin ?? '').localeCompare(a.fechaFin ?? ''));
    const chosenEnded = endedSorted[0];
    return {
      status: 'no_upcoming',
      deviceAvailability,
      ruleId: chosenEnded.rule.id,
      rulesCount: targetRules.length,
      enabledRulesCount: enabledRules.length,
      allEnabledRulesCount,
      otherEnabledRulesCount,
      notificationId: null,
      fechaPrevistaUtc: null,
      fechaCivilLocal: null,
      horaMinutoLocal: null,
      zonaHoraria: chosenEnded.rule.zonaHoraria || DEFAULT_TIMEZONE,
      noUpcomingReason: 'ended',
      fechaInicio: chosenEnded.fechaInicio,
      fechaFin: chosenEnded.fechaFin,
      cubiertoHastaIso: null,
      truncadas: plan.truncadas,
    };
  }

  // 6, 7 & 8. Filtrar notificaciones futuras de reglas habilitadas, mismo paciente, revisión vigente y ocurrencia elegible
  const enabledRulesById = new Map<string, ReminderRule>();
  for (const r of enabledRules) {
    enabledRulesById.set(r.id, r);
  }

  const eligibleByKey = new Map(
    eligibleOccurrences.map((occ) => [
      `${occ.recordatorioId}:${occ.revision}:${occ.fechaPrevistaUtc}`,
      occ,
    ]),
  );

  const candidateNotifications: NotificationItem[] = snapshot.futureNotifications
    .filter((n) => {
      if (n.pacienteId !== snapshot.patientId) return false;
      if (n.fechaPrevistaUtc <= snapshot.nowIso) return false;
      const rule = enabledRulesById.get(n.recordatorioId);
      if (!rule || rule.revision !== n.revision) return false;
      if (n.estado !== 'pendiente' && n.estado !== 'programada' && n.estado !== 'error') {
        return false;
      }
      return eligibleByKey.has(`${n.recordatorioId}:${n.revision}:${n.fechaPrevistaUtc}`);
    })
    .sort((a, b) => {
      const dateCmp = a.fechaPrevistaUtc.localeCompare(b.fechaPrevistaUtc);
      if (dateCmp !== 0) return dateCmp;
      return a.id.localeCompare(b.id);
    });

  const confirmedNotifications = candidateNotifications.filter(
    (n) =>
      n.estado === 'programada' && typeof n.idNativo === 'string' && n.idNativo.trim().length > 0,
  );

  const coord = options.coordinatorInFlight ? null : (options.coordinatorResult ?? null);
  const coordinatorBlockedConfirmation =
    coord !== null &&
    (coord.status === 'error' ||
      coord.status === 'permiso_denegado' ||
      coord.status === 'desactivada' ||
      coord.motivoPendiente === 'contexto_anterior');

  const cubiertoHastaIso =
    coord?.cubiertoHastaIso ??
    (confirmedNotifications.length > 0
      ? confirmedNotifications[confirmedNotifications.length - 1].fechaPrevistaUtc
      : null);

  // 9. Si hay programada con id_nativo no vacío y confirmación de coordinación vigente: scheduled
  if (confirmedNotifications.length > 0 && !coordinatorBlockedConfirmation) {
    const nextConfirmed = confirmedNotifications[0];
    const matchedOcc = eligibleByKey.get(
      `${nextConfirmed.recordatorioId}:${nextConfirmed.revision}:${nextConfirmed.fechaPrevistaUtc}`,
    )!;
    const matchedRule = enabledRulesById.get(nextConfirmed.recordatorioId)!;

    return {
      status: 'scheduled',
      deviceAvailability,
      ruleId: matchedRule.id,
      rulesCount: targetRules.length,
      enabledRulesCount: enabledRules.length,
      allEnabledRulesCount,
      otherEnabledRulesCount,
      notificationId: nextConfirmed.id,
      fechaPrevistaUtc: nextConfirmed.fechaPrevistaUtc,
      fechaCivilLocal: matchedOcc.fechaCivilLocal,
      horaMinutoLocal: matchedOcc.horaMinutoLocal,
      zonaHoraria: matchedRule.zonaHoraria || DEFAULT_TIMEZONE,
      noUpcomingReason: null,
      fechaInicio: matchedRule.fechaInicio,
      fechaFin: matchedRule.fechaFin,
      cubiertoHastaIso,
      truncadas: coord?.truncadas ?? plan.truncadas,
    };
  }

  const nextEligible = eligibleOccurrences[0];
  const nextRule = enabledRulesById.get(nextEligible.recordatorioId) ?? enabledRules[0];

  // 11. Si el coordinador terminó con fallo o las candidatas relevantes están en error: scheduling_failed
  const hasCandidateError = candidateNotifications.some((n) => n.estado === 'error');
  const coordinatorFailed =
    coord !== null && (coord.status === 'error' || coord.status === 'programacion_pendiente');

  if (hasCandidateError || coordinatorFailed) {
    return {
      status: 'scheduling_failed',
      deviceAvailability,
      ruleId: nextRule.id,
      rulesCount: targetRules.length,
      enabledRulesCount: enabledRules.length,
      allEnabledRulesCount,
      otherEnabledRulesCount,
      notificationId: null,
      fechaPrevistaUtc: nextEligible.fechaPrevistaUtc,
      fechaCivilLocal: nextEligible.fechaCivilLocal,
      horaMinutoLocal: nextEligible.horaMinutoLocal,
      zonaHoraria: nextRule.zonaHoraria || DEFAULT_TIMEZONE,
      noUpcomingReason: null,
      fechaInicio: nextRule.fechaInicio,
      fechaFin: nextRule.fechaFin,
      cubiertoHastaIso: null,
      truncadas: coord?.truncadas ?? plan.truncadas,
    };
  }

  // 10. Ocurrencias elegibles que faltan o están pendientes (o programada sin id_nativo): pending_scheduling
  return {
    status: 'pending_scheduling',
    deviceAvailability,
    ruleId: nextRule.id,
    rulesCount: targetRules.length,
    enabledRulesCount: enabledRules.length,
    allEnabledRulesCount,
    otherEnabledRulesCount,
    notificationId: null,
    fechaPrevistaUtc: nextEligible.fechaPrevistaUtc,
    fechaCivilLocal: nextEligible.fechaCivilLocal,
    horaMinutoLocal: nextEligible.horaMinutoLocal,
    zonaHoraria: nextRule.zonaHoraria || DEFAULT_TIMEZONE,
    noUpcomingReason: null,
    fechaInicio: nextRule.fechaInicio,
    fechaFin: nextRule.fechaFin,
    cubiertoHastaIso: null,
    truncadas: plan.truncadas,
  };
}

export function classifyMeasurementReminderStatus(
  snapshot: ReminderStatusSnapshot,
  options: Omit<ClassifyReminderStatusOptions, 'tipo'> = {},
): ReminderStatusEvaluation {
  return classifyReminderStatus(snapshot, { ...options, tipo: 'registro_vitales' });
}

/**
 * Formatea una fecha civil YYYY-MM-DD a DD/MM/YYYY sin usar conversión a zona UTC del navegador.
 */
export function formatCivilDateDisplay(civilDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate.trim());
  if (!match) return civilDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Formatea una fecha ISO UTC de cobertura al día civil DD/MM/YYYY en la zona horaria indicada.
 */
export function formatCoverageDateDisplay(
  cubiertoHastaIso: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const parts = getCivilPartsInTimeZone(cubiertoHastaIso, timeZone);
  return formatCivilDateDisplay(parts.civilDate);
}

/**
 * Formatea el próximo aviso confirmado: «Hoy a las 15:00», «Mañana a las 07:00» o «20/10/2026 a las 07:00».
 */
export function formatNextReminderLabel(
  fechaPrevistaUtc: string,
  nowIso: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const nowParts = getCivilPartsInTimeZone(nowIso, timeZone);
  const targetParts = getCivilPartsInTimeZone(fechaPrevistaUtc, timeZone);
  const tomorrowCivil = addDaysToCivilDate(nowParts.civilDate, 1);

  if (targetParts.civilDate === nowParts.civilDate) {
    return `Hoy a las ${targetParts.hourMinute}`;
  }
  if (targetParts.civilDate === tomorrowCivil) {
    return `Mañana a las ${targetParts.hourMinute}`;
  }
  return `${formatCivilDateDisplay(targetParts.civilDate)} a las ${targetParts.hourMinute}`;
}

const DAY_SHORT_NAMES: Record<number, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
};

export function formatDaysOfWeekSummary(diasSemana: readonly number[]): string {
  const uniqueSorted = Array.from(new Set(diasSemana)).sort((a, b) => a - b);
  if (uniqueSorted.length === 7) return 'Todos los días';
  if (
    uniqueSorted.length === 5 &&
    uniqueSorted[0] === 1 &&
    uniqueSorted[1] === 2 &&
    uniqueSorted[2] === 3 &&
    uniqueSorted[3] === 4 &&
    uniqueSorted[4] === 5
  ) {
    return 'Lunes a viernes';
  }
  if (uniqueSorted.length === 2 && uniqueSorted[0] === 6 && uniqueSorted[1] === 7) {
    return 'Fines de semana';
  }
  return uniqueSorted.map((d) => DAY_SHORT_NAMES[d] ?? `${d}`).join(', ');
}

export function formatRuleScheduleSummary(
  rule: Pick<ReminderRule, 'diasSemana' | 'horasMinutos' | 'zonaHoraria'>,
  deviceTimeZone?: string,
): string {
  const sortedHours = [...rule.horasMinutos].sort().join(', ');
  const daysLabel = formatDaysOfWeekSummary(rule.diasSemana);
  const resolvedDeviceTz =
    deviceTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  const tzSuffix =
    rule.zonaHoraria && rule.zonaHoraria !== resolvedDeviceTz ? ` (${rule.zonaHoraria})` : '';
  return `${sortedHours} · ${daysLabel}${tzSuffix}`;
}
