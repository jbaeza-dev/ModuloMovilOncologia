import { describe, expect, it, vi } from 'vitest';

import type {
  ReminderRule,
  ReminderStatusSnapshot,
} from '../../data/local/reminders/reminder-types';
import { saveReminderWithActivation } from './reminder-actions';

const baseRule: ReminderRule = {
  id: 'rule-saved-1',
  pacienteId: 'patient-a',
  tipo: 'registro_vitales',
  medicamentoId: null,
  diasSemana: [1, 2, 3, 4, 5, 6, 7],
  horasMinutos: ['07:00'],
  zonaHoraria: 'America/Santiago',
  fechaInicio: null,
  fechaFin: null,
  habilitado: true,
  revision: 2,
  eliminadoEl: null,
  creadoEl: '2026-10-16T12:00:00.000Z',
  actualizadoEl: '2026-10-16T12:00:00.000Z',
};

describe('saveReminderWithActivation (reminder-actions)', () => {
  it('retorna scheduled solo cuando la regla recién guardada tiene una ocurrencia futura confirmada con su misma revisión', async () => {
    const snapshot: ReminderStatusSnapshot = {
      patientId: 'patient-a',
      nowIso: '2026-10-16T12:00:00.000Z',
      preferences: { enabled: true, updatedAt: '2026-10-16T12:00:00.000Z' },
      rules: [baseRule],
      futureNotifications: [
        {
          id: 'notif-1',
          pacienteId: 'patient-a',
          recordatorioId: 'rule-saved-1',
          revision: 2,
          tipo: 'registro_vitales',
          fechaPrevistaUtc: '2026-10-17T10:00:00.000Z',
          idNativo: 'native-ok-1',
          estado: 'programada',
          payloadMinimo: {
            version: 1,
            notificacionId: 'notif-1',
            revision: 2,
            pacienteId: 'patient-a',
            recordatorioId: 'rule-saved-1',
            tipo: 'registro_vitales',
            destino: '/vitales/registrar',
          },
          error: null,
          recibidaObservadaEn: null,
          abiertaEn: null,
          creadoEl: '2026-10-16T12:00:00.000Z',
          actualizadoEl: '2026-10-16T12:00:00.000Z',
        },
      ],
      medications: [],
      allEnabledRulesCount: 1,
    };

    const outcome = await saveReminderWithActivation({
      patientId: 'patient-a',
      contextEpoch: 1,
      input: {
        id: 'rule-saved-1',
        tipo: 'registro_vitales',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00'],
      },
      intent: 'save_and_activate',
      remindersRepository: {
        saveRuleWithActivationIntent: vi.fn().mockResolvedValue({
          rule: baseRule,
          preferencesEnabled: true,
          otherEnabledRulesCount: 0,
          resumedGeneralPreference: true,
          pausedByGeneralPreference: false,
        }),
        getReminderStatusSnapshot: vi.fn().mockResolvedValue(snapshot),
      },
      notificationAdapter: {
        getPermissionState: vi.fn().mockResolvedValue({
          status: 'granted',
          canAskAgain: true,
          channelStatus: 'ok',
        }),
        requestPermission: vi.fn(),
      },
      reconcileReminders: vi.fn().mockResolvedValue({
        status: 'programada',
        totalDeseadas: 14,
        programadasConfirmadas: 14,
        cubiertoHastaIso: '2026-10-30T10:00:00.000Z',
        truncadas: 0,
        reglasAfectadas: ['rule-saved-1'],
        incidencias: [],
      }),
    });

    expect(outcome.kind).toBe('scheduled');
  });

  it('retorna saved_no_upcoming cuando el coordinador devuelve programada pero la regla recién guardada inicia fuera de la ventana de 14 días', async () => {
    const futureRule: ReminderRule = {
      ...baseRule,
      fechaInicio: '2026-12-01',
      fechaFin: '2026-12-10',
    };
    const snapshot: ReminderStatusSnapshot = {
      patientId: 'patient-a',
      nowIso: '2026-10-16T12:00:00.000Z',
      preferences: { enabled: true, updatedAt: '2026-10-16T12:00:00.000Z' },
      rules: [futureRule],
      futureNotifications: [],
      medications: [],
      allEnabledRulesCount: 1,
    };

    const outcome = await saveReminderWithActivation({
      patientId: 'patient-a',
      contextEpoch: 1,
      input: {
        id: futureRule.id,
        tipo: 'registro_vitales',
        diasSemana: futureRule.diasSemana,
        horasMinutos: futureRule.horasMinutos,
        fechaInicio: futureRule.fechaInicio,
        fechaFin: futureRule.fechaFin,
      },
      intent: 'save_and_activate',
      remindersRepository: {
        saveRuleWithActivationIntent: vi.fn().mockResolvedValue({
          rule: futureRule,
          preferencesEnabled: true,
          otherEnabledRulesCount: 1,
          resumedGeneralPreference: false,
          pausedByGeneralPreference: false,
        }),
        getReminderStatusSnapshot: vi.fn().mockResolvedValue(snapshot),
      },
      notificationAdapter: {
        getPermissionState: vi.fn().mockResolvedValue({
          status: 'granted',
          canAskAgain: true,
          channelStatus: 'ok',
        }),
        requestPermission: vi.fn(),
      },
      // Aunque el coordinador global diga 'programada' (por ej. con 0 deseadas o por otra regla),
      // la regla recién guardada no tiene ocurrencias próximas en la ventana de 14 días.
      reconcileReminders: vi.fn().mockResolvedValue({
        status: 'programada',
        totalDeseadas: 0,
        programadasConfirmadas: 0,
        cubiertoHastaIso: null,
        truncadas: 0,
        reglasAfectadas: [],
        incidencias: [],
      }),
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'saved_no_upcoming',
        reason: 'starts_after_window',
      }),
    );
  });

  it('retorna saved_pending_scheduling cuando el coordinador reporta programacion_pendiente', async () => {
    const outcome = await saveReminderWithActivation({
      patientId: 'patient-a',
      contextEpoch: 1,
      input: {
        tipo: 'registro_vitales',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00'],
      },
      intent: 'save_and_activate',
      remindersRepository: {
        saveRuleWithActivationIntent: vi.fn().mockResolvedValue({
          rule: baseRule,
          preferencesEnabled: true,
          otherEnabledRulesCount: 0,
          resumedGeneralPreference: false,
          pausedByGeneralPreference: false,
        }),
        getReminderStatusSnapshot: vi.fn().mockResolvedValue({
          patientId: 'patient-a',
          nowIso: '2026-10-16T12:00:00.000Z',
          preferences: { enabled: true, updatedAt: '2026-10-16T12:00:00.000Z' },
          rules: [baseRule],
          futureNotifications: [],
          medications: [],
          allEnabledRulesCount: 1,
        }),
      },
      notificationAdapter: {
        getPermissionState: vi.fn().mockResolvedValue({
          status: 'granted',
          canAskAgain: true,
          channelStatus: 'ok',
        }),
        requestPermission: vi.fn(),
      },
      reconcileReminders: vi.fn().mockResolvedValue({
        status: 'programacion_pendiente',
        motivoPendiente: 'cancelacion_regla_previa',
        totalDeseadas: 14,
        programadasConfirmadas: 0,
        cubiertoHastaIso: null,
        truncadas: 0,
        reglasAfectadas: ['rule-saved-1'],
        incidencias: ['Limpiando versión anterior'],
      }),
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'saved_pending_scheduling',
        reason: 'cancelacion_regla_previa',
      }),
    );
  });

  it('T-17: retorna saved_preferences_paused con el conteo de otras reglas habilitadas cuando la pausa general está activa y existen otras reglas', async () => {
    const reconcileSpy = vi.fn();
    const outcome = await saveReminderWithActivation({
      patientId: 'patient-a',
      contextEpoch: 1,
      input: {
        tipo: 'registro_vitales',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00'],
      },
      intent: 'save_and_activate',
      remindersRepository: {
        saveRuleWithActivationIntent: vi.fn().mockResolvedValue({
          rule: baseRule,
          preferencesEnabled: false,
          otherEnabledRulesCount: 2,
          resumedGeneralPreference: false,
          pausedByGeneralPreference: true,
        }),
        getReminderStatusSnapshot: vi.fn(),
      },
      notificationAdapter: {
        getPermissionState: vi.fn().mockResolvedValue({
          status: 'granted',
          canAskAgain: true,
          channelStatus: 'ok',
        }),
        requestPermission: vi.fn(),
      },
      reconcileReminders: reconcileSpy,
    });

    expect(outcome).toEqual({
      kind: 'saved_preferences_paused',
      rule: baseRule,
      otherEnabledRulesCount: 2,
    });
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('T-16: retorna saved_permission_denied sin levantar la pausa general cuando el permiso nativo es rechazado', async () => {
    const saveWithIntentSpy = vi.fn().mockResolvedValue({
      rule: baseRule,
      preferencesEnabled: false,
      otherEnabledRulesCount: 0,
      resumedGeneralPreference: false,
      pausedByGeneralPreference: true,
    });
    const reconcileSpy = vi.fn();

    const outcome = await saveReminderWithActivation({
      patientId: 'patient-a',
      contextEpoch: 1,
      input: {
        tipo: 'registro_vitales',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00'],
      },
      intent: 'save_and_activate',
      remindersRepository: {
        saveRuleWithActivationIntent: saveWithIntentSpy,
        getReminderStatusSnapshot: vi.fn(),
      },
      notificationAdapter: {
        getPermissionState: vi.fn().mockResolvedValue({
          status: 'undetermined',
          canAskAgain: true,
          channelStatus: 'ok',
        }),
        requestPermission: vi.fn().mockResolvedValue({
          status: 'denied',
          canAskAgain: false,
          channelStatus: 'ok',
        }),
      },
      reconcileReminders: reconcileSpy,
    });

    expect(saveWithIntentSpy).toHaveBeenCalledWith(expect.any(Object), 'keep_existing');
    expect(outcome).toEqual({
      kind: 'saved_permission_denied',
      rule: baseRule,
      permissionState: {
        status: 'denied',
        canAskAgain: false,
        channelStatus: 'ok',
      },
    });
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('T-20: aborta sin escribir en SQLite si cambia (patientId, contextEpoch) mientras el diálogo de permiso nativo está abierto', async () => {
    let activeEpoch = 1;
    const saveWithIntentSpy = vi.fn();
    const reconcileSpy = vi.fn();

    const outcome = await saveReminderWithActivation({
      patientId: 'patient-a',
      contextEpoch: 1,
      isContextActive: (pid, epoch) => pid === 'patient-a' && epoch === activeEpoch,
      input: {
        tipo: 'registro_vitales',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00'],
      },
      intent: 'save_and_activate',
      remindersRepository: {
        saveRuleWithActivationIntent: saveWithIntentSpy,
        getReminderStatusSnapshot: vi.fn(),
      },
      notificationAdapter: {
        getPermissionState: vi.fn().mockResolvedValue({
          status: 'undetermined',
          canAskAgain: true,
          channelStatus: 'ok',
        }),
        requestPermission: vi.fn().mockImplementation(async () => {
          // Simular cierre de sesión o cambio de paciente durante el diálogo del sistema
          activeEpoch = 2;
          return {
            status: 'granted',
            canAskAgain: true,
            channelStatus: 'ok',
          };
        }),
      },
      reconcileReminders: reconcileSpy,
    });

    expect(outcome).toEqual({ kind: 'context_changed' });
    expect(saveWithIntentSpy).not.toHaveBeenCalled();
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('comprobación de persistencia real: al rechazar permisos conserva preferencia general desactivada y no reconcilia', async () => {
    const { createSqliteTestHarness, patientA, patientB } =
      await import('../../data/local/testing/sqlite-test-harness');
    const { migrateDatabase } = await import('../../data/local/migrations');
    const { seedPatientContextIfEmpty } = await import('../../data/local/repository');
    const { createReminderRepository } =
      await import('../../data/local/reminders/reminder-repository');

    const harness = createSqliteTestHarness();
    try {
      const db = harness.open();
      await migrateDatabase(db);
      await seedPatientContextIfEmpty(db, patientA, patientB);

      const realRepo = createReminderRepository(db, patientA);
      const initialPrefs = await realRepo.getPreferences();
      expect(initialPrefs.enabled).toBe(false);

      const reconcileSpy = vi.fn();
      const outcome = await saveReminderWithActivation({
        patientId: patientA,
        contextEpoch: 1,
        input: {
          tipo: 'registro_vitales',
          diasSemana: [1, 2, 3, 4, 5, 6, 7],
          horasMinutos: ['08:00'],
        },
        intent: 'save_and_activate',
        remindersRepository: realRepo,
        notificationAdapter: {
          getPermissionState: vi.fn().mockResolvedValue({
            status: 'undetermined',
            canAskAgain: true,
            channelStatus: 'ok',
          }),
          requestPermission: vi.fn().mockResolvedValue({
            status: 'denied',
            canAskAgain: false,
            channelStatus: 'ok',
          }),
        },
        reconcileReminders: reconcileSpy,
      });

      expect(outcome.kind).toBe('saved_permission_denied');
      if (outcome.kind === 'saved_permission_denied') {
        expect(outcome.rule.habilitado).toBe(true);
        expect(outcome.rule.horasMinutos).toEqual(['08:00']);
      }

      // Verificación en SQLite real: preferencia general continúa desactivada
      const prefsAfter = await realRepo.getPreferences();
      expect(prefsAfter.enabled).toBe(false);

      // Verificación en SQLite real: la regla está guardada con habilitado = 1
      const rulesInDb = await realRepo.listRules();
      const savedInDb = rulesInDb.find((r) => r.horasMinutos.includes('08:00'));
      expect(savedInDb).toBeDefined();
      expect(savedInDb?.habilitado).toBe(true);

      // No se ejecuta la reconciliación cuando los permisos fueron denegados
      expect(reconcileSpy).not.toHaveBeenCalled();
    } finally {
      harness.cleanup();
    }
  });
});
