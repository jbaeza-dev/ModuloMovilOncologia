import { describe, expect, it } from 'vitest';

import type {
  NotificationItem,
  ReminderRule,
  ReminderStatusSnapshot,
} from '../../data/local/reminders/reminder-types';
import {
  classifyMeasurementReminderStatus,
  classifyReminderStatus,
  createQueryErrorReminderStatus,
  formatCivilDateDisplay,
  formatCoverageDateDisplay,
  formatNextReminderLabel,
  formatRuleScheduleSummary,
} from './reminder-status';

const NOW_ISO = '2026-10-16T12:00:00.000Z'; // 09:00 en America/Santiago (UTC-3)
const PATIENT_A = 'patient-a';

function makeRule(overrides: Partial<ReminderRule> = {}): ReminderRule {
  return {
    id: 'rule-vitals-1',
    pacienteId: PATIENT_A,
    tipo: 'registro_vitales',
    medicamentoId: null,
    diasSemana: [1, 2, 3, 4, 5, 6, 7],
    horasMinutos: ['15:00'],
    zonaHoraria: 'America/Santiago',
    fechaInicio: null,
    fechaFin: null,
    habilitado: true,
    revision: 1,
    eliminadoEl: null,
    creadoEl: '2026-10-01T00:00:00.000Z',
    actualizadoEl: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'notif-1',
    pacienteId: PATIENT_A,
    recordatorioId: 'rule-vitals-1',
    revision: 1,
    tipo: 'registro_vitales',
    fechaPrevistaUtc: '2026-10-16T18:00:00.000Z', // 15:00 en America/Santiago
    idNativo: 'native-os-1',
    estado: 'programada',
    payloadMinimo: {
      version: 1,
      notificacionId: 'notif-1',
      revision: 1,
      pacienteId: PATIENT_A,
      recordatorioId: 'rule-vitals-1',
      tipo: 'registro_vitales',
      destino: '/vitales/registrar',
    },
    error: null,
    recibidaObservadaEn: null,
    abiertaEn: null,
    creadoEl: '2026-10-16T00:00:00.000Z',
    actualizadoEl: '2026-10-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ReminderStatusSnapshot> = {}): ReminderStatusSnapshot {
  const rules = overrides.rules ?? [];
  return {
    patientId: PATIENT_A,
    nowIso: NOW_ISO,
    preferences: {
      enabled: true,
      updatedAt: '2026-10-16T00:00:00.000Z',
    },
    rules,
    futureNotifications: [],
    medications: [],
    allEnabledRulesCount: rules.filter((r) => r.habilitado && r.eliminadoEl === null).length,
    ...overrides,
  };
}

describe('reminder-status classifier (T-01 a T-11)', () => {
  it('T-01: sin reglas y con preferencias generales apagadas clasifica no_configured', () => {
    const snapshot = makeSnapshot({
      preferences: { enabled: false, updatedAt: null },
      rules: [],
    });

    const result = classifyMeasurementReminderStatus(snapshot);
    expect(result.status).toBe('no_configured');
    expect(result.ruleId).toBeNull();
  });

  it('T-02: con reglas presentes pero todas deshabilitadas clasifica rule_disabled', () => {
    const snapshot = makeSnapshot({
      rules: [
        makeRule({ id: 'rule-1', habilitado: false }),
        makeRule({ id: 'rule-2', habilitado: false }),
      ],
    });

    const result = classifyMeasurementReminderStatus(snapshot);
    expect(result.status).toBe('rule_disabled');
    expect(result.ruleId).toBe('rule-1');
    expect(result.rulesCount).toBe(2);
    expect(result.enabledRulesCount).toBe(0);
  });

  it('T-03: con regla habilitada y pausa general clasifica preferences_disabled e informa reglas afectadas de ambos tipos', () => {
    const snapshot = makeSnapshot({
      preferences: { enabled: false, updatedAt: '2026-10-16T00:00:00.000Z' },
      rules: [
        makeRule({ id: 'rule-vitals', tipo: 'registro_vitales', habilitado: true }),
        makeRule({
          id: 'rule-med-1',
          tipo: 'medicacion',
          medicamentoId: 'med-1',
          habilitado: true,
        }),
      ],
    });

    const result = classifyMeasurementReminderStatus(snapshot);
    expect(result.status).toBe('preferences_disabled');
    expect(result.ruleId).toBe('rule-vitals');
    expect(result.allEnabledRulesCount).toBe(2);
    expect(result.otherEnabledRulesCount).toBe(1);
  });

  it('T-04: con próxima ocurrencia programada, id_nativo no vacío y revisión vigente clasifica scheduled', () => {
    const snapshot = makeSnapshot({
      rules: [makeRule({ id: 'rule-vitals-1', revision: 2, horasMinutos: ['15:00'] })],
      futureNotifications: [
        makeNotification({
          id: 'notif-confirmed',
          recordatorioId: 'rule-vitals-1',
          revision: 2,
          fechaPrevistaUtc: '2026-10-16T18:00:00.000Z',
          idNativo: 'native-confirmed-99',
          estado: 'programada',
        }),
      ],
    });

    const result = classifyMeasurementReminderStatus(snapshot);
    expect(result.status).toBe('scheduled');
    expect(result.notificationId).toBe('notif-confirmed');
    expect(result.fechaPrevistaUtc).toBe('2026-10-16T18:00:00.000Z');
    expect(result.fechaCivilLocal).toBe('2026-10-16');
    expect(result.horaMinutoLocal).toBe('15:00');
  });

  it('T-05: excluye filas en estado cancelada, cancelacion_pendiente o finalizada_sin_observacion', () => {
    const snapshot = makeSnapshot({
      rules: [makeRule({ id: 'rule-vitals-1', revision: 1, horasMinutos: ['15:00'] })],
      futureNotifications: [
        makeNotification({ id: 'n-canc', estado: 'cancelada' }),
        makeNotification({ id: 'n-pend-canc', estado: 'cancelacion_pendiente' }),
        makeNotification({ id: 'n-fin', estado: 'finalizada_sin_observacion' }),
      ],
    });

    const result = classifyMeasurementReminderStatus(snapshot);
    expect(result.status).toBe('pending_scheduling');
    expect(result.notificationId).toBeNull();
  });

  it('T-06: ignora filas de revisión antigua, de otro paciente o fuera de la pauta actual', () => {
    const snapshot = makeSnapshot({
      rules: [makeRule({ id: 'rule-vitals-1', revision: 3, horasMinutos: ['15:00'] })],
      futureNotifications: [
        // Revisión antigua (2 != 3)
        makeNotification({
          id: 'n-old-rev',
          revision: 2,
          fechaPrevistaUtc: '2026-10-16T18:00:00.000Z',
          estado: 'programada',
        }),
        // Otro paciente
        makeNotification({
          id: 'n-other-patient',
          pacienteId: 'patient-b',
          revision: 3,
          fechaPrevistaUtc: '2026-10-16T18:00:00.000Z',
          estado: 'programada',
        }),
        // Hora que no pertenece a la pauta actual (16:00 local = 19:00 UTC)
        makeNotification({
          id: 'n-stale-time',
          revision: 3,
          fechaPrevistaUtc: '2026-10-16T19:00:00.000Z',
          estado: 'programada',
        }),
      ],
    });

    const result = classifyMeasurementReminderStatus(snapshot);
    expect(result.status).toBe('pending_scheduling');
    expect(result.notificationId).toBeNull();
  });

  it('T-07: una fila programada sin id_nativo se trata como incompleta (pending_scheduling) y nunca como confirmada', () => {
    const snapshot = makeSnapshot({
      rules: [makeRule({ id: 'rule-vitals-1', revision: 1, horasMinutos: ['15:00'] })],
      futureNotifications: [
        makeNotification({
          id: 'n-missing-native',
          estado: 'programada',
          idNativo: null,
        }),
        makeNotification({
          id: 'n-blank-native',
          estado: 'programada',
          idNativo: '   ',
        }),
      ],
    });

    const result = classifyMeasurementReminderStatus(snapshot);
    expect(result.status).toBe('pending_scheduling');
    expect(result.notificationId).toBeNull();
  });

  it('T-08: distingue ocurrencias pendientes de programación vs fallo conocido en candidato o coordinador', () => {
    const baseSnapshot = makeSnapshot({
      rules: [makeRule({ id: 'rule-vitals-1', revision: 1, horasMinutos: ['15:00'] })],
      futureNotifications: [
        makeNotification({
          id: 'n-pending',
          estado: 'pendiente',
          idNativo: null,
        }),
      ],
    });

    // Sin fallo conocido -> pending_scheduling
    expect(classifyMeasurementReminderStatus(baseSnapshot).status).toBe('pending_scheduling');

    // Con candidato en estado error -> scheduling_failed
    const errorSnapshot = makeSnapshot({
      rules: [makeRule({ id: 'rule-vitals-1', revision: 1, horasMinutos: ['15:00'] })],
      futureNotifications: [
        makeNotification({
          id: 'n-error',
          estado: 'error',
          idNativo: null,
          error: 'Fallo del sistema',
        }),
      ],
    });
    expect(classifyMeasurementReminderStatus(errorSnapshot).status).toBe('scheduling_failed');

    // Con coordinador terminado en error -> scheduling_failed
    expect(
      classifyMeasurementReminderStatus(baseSnapshot, {
        coordinatorResult: {
          status: 'error',
          totalDeseadas: 14,
          programadasConfirmadas: 0,
          cubiertoHastaIso: null,
          truncadas: 0,
          reglasAfectadas: [],
          incidencias: ['Fallo nativo'],
        },
      }).status,
    ).toBe('scheduling_failed');
  });

  it('T-09: distingue pauta finalizada, inicio posterior a la ventana y ausencia de próximas ocurrencias en no_upcoming', () => {
    // 1. Pauta finalizada (ayer 2026-10-15)
    const endedSnapshot = makeSnapshot({
      rules: [
        makeRule({
          id: 'rule-ended',
          fechaInicio: '2026-10-01',
          fechaFin: '2026-10-15',
        }),
      ],
    });
    const endedRes = classifyMeasurementReminderStatus(endedSnapshot);
    expect(endedRes.status).toBe('no_upcoming');
    expect(endedRes.noUpcomingReason).toBe('ended');
    expect(endedRes.fechaFin).toBe('2026-10-15');

    // 2. Pauta que inicia fuera de la ventana de 14 días (2026-11-10)
    const futureSnapshot = makeSnapshot({
      rules: [
        makeRule({
          id: 'rule-future',
          fechaInicio: '2026-11-10',
          fechaFin: '2026-11-20',
        }),
      ],
    });
    const futureRes = classifyMeasurementReminderStatus(futureSnapshot);
    expect(futureRes.status).toBe('no_upcoming');
    expect(futureRes.noUpcomingReason).toBe('starts_after_window');
    expect(futureRes.fechaInicio).toBe('2026-11-10');

    // 3. Pauta vigente dentro de la ventana pero sin días coincidentes en el rango [fechaInicio, fechaFin]
    // 2026-10-17 es sábado (6) y 2026-10-18 es domingo (7), pero la regla solo tiene lunes (1)
    const noDaysSnapshot = makeSnapshot({
      rules: [
        makeRule({
          id: 'rule-no-days',
          diasSemana: [1],
          fechaInicio: '2026-10-17',
          fechaFin: '2026-10-18',
        }),
      ],
    });
    const noDaysRes = classifyMeasurementReminderStatus(noDaysSnapshot);
    expect(noDaysRes.status).toBe('no_upcoming');
    expect(noDaysRes.noUpcomingReason).toBe('no_matching_days');
  });

  it('T-10: una regla vencida no oculta otra regla vigente y el desempate es determinista', () => {
    const expiredRule = makeRule({
      id: 'rule-expired',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-10',
      creadoEl: '2026-09-01T00:00:00.000Z',
    });
    const validRule = makeRule({
      id: 'rule-valid',
      horasMinutos: ['15:00'],
      creadoEl: '2026-10-01T00:00:00.000Z',
    });

    const snapshot = makeSnapshot({
      rules: [expiredRule, validRule],
      futureNotifications: [
        makeNotification({
          id: 'notif-valid',
          recordatorioId: 'rule-valid',
          revision: 1,
          fechaPrevistaUtc: '2026-10-16T18:00:00.000Z',
          idNativo: 'native-valid',
          estado: 'programada',
        }),
      ],
    });

    const result = classifyMeasurementReminderStatus(snapshot);
    expect(result.status).toBe('scheduled');
    expect(result.ruleId).toBe('rule-valid');
    expect(result.notificationId).toBe('notif-valid');
  });

  it('T-11: representa query_error de forma independiente y refleja disponibilidad de permisos del dispositivo', () => {
    const queryErr = createQueryErrorReminderStatus();
    expect(queryErr.status).toBe('query_error');

    const snapshot = makeSnapshot({
      rules: [makeRule({ id: 'rule-1' })],
    });
    const blockedPerm = classifyReminderStatus(snapshot, {
      permissionState: {
        status: 'denied',
        canAskAgain: false,
        channelStatus: 'ok',
      },
    });
    expect(blockedPerm.deviceAvailability).toBe('permission_blocked');

    const blockedChannel = classifyReminderStatus(snapshot, {
      permissionState: {
        status: 'granted',
        canAskAgain: true,
        channelStatus: 'blocked',
      },
    });
    expect(blockedChannel.deviceAvailability).toBe('channel_blocked');
  });

  it('formatea fechas civiles, cobertura y etiquetas de próximo aviso sin desfase UTC', () => {
    expect(formatCivilDateDisplay('2026-10-16')).toBe('16/10/2026');
    expect(formatCoverageDateDisplay('2026-10-30T18:00:00.000Z', 'America/Santiago')).toBe(
      '30/10/2026',
    );
    expect(formatNextReminderLabel('2026-10-16T18:00:00.000Z', NOW_ISO, 'America/Santiago')).toBe(
      'Hoy a las 15:00',
    );
    expect(formatNextReminderLabel('2026-10-17T10:00:00.000Z', NOW_ISO, 'America/Santiago')).toBe(
      'Mañana a las 07:00',
    );
    expect(formatNextReminderLabel('2026-10-20T10:00:00.000Z', NOW_ISO, 'America/Santiago')).toBe(
      '20/10/2026 a las 07:00',
    );

    expect(
      formatRuleScheduleSummary(
        {
          diasSemana: [1, 2, 3, 4, 5, 6, 7],
          horasMinutos: ['19:00', '07:00'],
          zonaHoraria: 'America/Santiago',
        },
        'America/Santiago',
      ),
    ).toBe('07:00, 19:00 · Todos los días');

    expect(
      formatRuleScheduleSummary(
        {
          diasSemana: [1, 3, 5],
          horasMinutos: ['07:00'],
          zonaHoraria: 'America/Lima',
        },
        'America/Santiago',
      ),
    ).toBe('07:00 · Lun, Mié, Vie (America/Lima)');
  });
});
