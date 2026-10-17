import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../migrations';
import { seedPatientContextIfEmpty } from '../repository';
import { createSqliteTestHarness, patientA, patientB } from '../testing/sqlite-test-harness';
import { createReminderRepository } from './reminder-repository';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('ReminderRepository', () => {
  it('gestiona preferencias de avisos por paciente con valor inicial desactivado', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repoA = createReminderRepository(db, patientA);
    const repoB = createReminderRepository(db, patientB);

    // Inicialmente deshabilitado
    const prefsA = await repoA.getPreferences();
    expect(prefsA.enabled).toBe(false);
    expect(prefsA.updatedAt).not.toBeNull();

    // Activar para paciente A
    await repoA.setPreferences(true);
    expect((await repoA.getPreferences()).enabled).toBe(true);

    // Paciente B permanece deshabilitado (aislamiento estricto)
    expect((await repoB.getPreferences()).enabled).toBe(false);
  });

  it('valida datos de entrada al crear o actualizar una regla', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);

    // Sin días
    await expect(
      repo.saveRule({
        tipo: 'registro_vitales',
        diasSemana: [],
        horasMinutos: ['08:00'],
      }),
    ).rejects.toThrow('Debes seleccionar al menos un día');

    // Días duplicados
    await expect(
      repo.saveRule({
        tipo: 'registro_vitales',
        diasSemana: [1, 1],
        horasMinutos: ['08:00'],
      }),
    ).rejects.toThrow('No se permiten días duplicados');

    // Día fuera de rango
    await expect(
      repo.saveRule({
        tipo: 'registro_vitales',
        diasSemana: [0],
        horasMinutos: ['08:00'],
      }),
    ).rejects.toThrow('Día de la semana inválido');

    // Sin horas
    await expect(
      repo.saveRule({
        tipo: 'registro_vitales',
        diasSemana: [1],
        horasMinutos: [],
      }),
    ).rejects.toThrow('Debes configurar al menos una hora');

    // Hora con formato inválido
    await expect(
      repo.saveRule({
        tipo: 'registro_vitales',
        diasSemana: [1],
        horasMinutos: ['8:00'],
      }),
    ).rejects.toThrow('Hora inválida');

    // Horas duplicadas
    await expect(
      repo.saveRule({
        tipo: 'registro_vitales',
        diasSemana: [1],
        horasMinutos: ['08:00', '08:00'],
      }),
    ).rejects.toThrow('No se permiten horas duplicadas');

    // Medicación sin medicamento
    await expect(
      repo.saveRule({
        tipo: 'medicacion',
        medicamentoId: null,
        diasSemana: [1],
        horasMinutos: ['08:00'],
      }),
    ).rejects.toThrow('exige vincular un medicamento');

    // Vitales con medicamento
    await expect(
      repo.saveRule({
        tipo: 'registro_vitales',
        medicamentoId: 'med-a-1',
        diasSemana: [1],
        horasMinutos: ['08:00'],
      }),
    ).rejects.toThrow('no debe vincular un medicamento');

    // Fechas invertidas
    await expect(
      repo.saveRule({
        tipo: 'registro_vitales',
        diasSemana: [1],
        horasMinutos: ['08:00'],
        fechaInicio: '2026-12-31',
        fechaFin: '2026-01-01',
      }),
    ).rejects.toThrow('La fecha de inicio no puede ser posterior');
  });

  it('guarda, edita e incrementa revision de reglas correctamente', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);

    // Crear regla nueva
    const created = await repo.saveRule({
      tipo: 'medicacion',
      medicamentoId: 'med-a-1',
      diasSemana: [1, 3, 5],
      horasMinutos: ['08:00', '20:00'],
      habilitado: true,
    });

    expect(created.id).toBeDefined();
    expect(created.revision).toBe(1);
    expect(created.habilitado).toBe(true);
    expect(created.diasSemana).toEqual([1, 3, 5]);

    // Consultar por ID
    const fetched = await repo.getRule(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.medicamentoId).toBe('med-a-1');

    // Actualizar regla existente
    const updated = await repo.saveRule({
      id: created.id,
      tipo: 'medicacion',
      medicamentoId: 'med-a-1',
      diasSemana: [1, 2, 3, 4, 5],
      horasMinutos: ['09:00'],
      habilitado: false,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.revision).toBe(2);
    expect(updated.habilitado).toBe(false);
    expect(updated.horasMinutos).toEqual(['09:00']);

    // Comprobar que en base de datos quedó en revision 2
    const fetchedAfter = await repo.getRule(created.id);
    expect(fetchedAfter?.revision).toBe(2);
    expect(fetchedAfter?.habilitado).toBe(false);
  });

  it('aplica baja lógica con deleteRule conservando histórico y cancelando trabajos futuros', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);

    const rule = await repo.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['09:00'],
      habilitado: true,
    });

    // Crear una notificación programada vinculada a la regla
    await repo.reserveOccurrence({
      id: 'job-cancel-test',
      recordatorioId: rule.id,
      revision: 1,
      tipo: 'registro_vitales',
      fechaPrevistaUtc: '2026-10-15T12:00:00Z',
      payload: {
        version: 1,
        notificacionId: 'job-cancel-test',
        revision: 1,
        pacienteId: patientA,
        recordatorioId: rule.id,
        tipo: 'registro_vitales',
        destino: '/vitales/registrar',
      },
    });
    await repo.markNotificationScheduled('job-cancel-test', 'native-123');

    // Ejecutar baja lógica
    await repo.deleteRule(rule.id);

    // listRules() no debe incluir la regla eliminada
    const activeRules = await repo.listRules();
    expect(activeRules.some((r) => r.id === rule.id)).toBe(false);

    // listRules(true) sí debe conservarla con eliminadoEl
    const allRules = await repo.listRules(true);
    const deletedRule = allRules.find((r) => r.id === rule.id);
    expect(deletedRule?.eliminadoEl).not.toBeNull();
    expect(deletedRule?.revision).toBe(2); // incrementa revisión
    expect(deletedRule?.habilitado).toBe(false);

    // Los trabajos pendientes/programados pasan a cancelacion_pendiente
    const notif = await repo.getNotification('job-cancel-test');
    expect(notif?.estado).toBe('cancelacion_pendiente');
  });

  it('gestiona ciclo de vida de notificaciones con observación y apertura idempotente', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);
    const rule = await repo.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1],
      horasMinutos: ['09:00'],
      habilitado: true,
    });

    // 1. Reservar ocurrencia (estado: pendiente)
    await repo.reserveOccurrence({
      id: 'job-lifecycle',
      recordatorioId: rule.id,
      revision: 1,
      tipo: 'registro_vitales',
      fechaPrevistaUtc: '2026-10-15T12:00:00Z',
      payload: {
        version: 1,
        notificacionId: 'job-lifecycle',
        revision: 1,
        pacienteId: patientA,
        recordatorioId: rule.id,
        tipo: 'registro_vitales',
        destino: '/vitales/registrar',
      },
    });

    let job = await repo.getNotification('job-lifecycle');
    expect(job?.estado).toBe('pendiente');
    expect(job?.idNativo).toBeNull();

    // 2. Marcar programada con nativeId
    await repo.markNotificationScheduled('job-lifecycle', 'native-expo-456');
    job = await repo.getNotification('job-lifecycle');
    expect(job?.estado).toBe('programada');
    expect(job?.idNativo).toBe('native-expo-456');

    // 3. Registrar observación en primer plano
    await repo.recordNotificationObserved('job-lifecycle', '2026-10-15T12:00:01Z');
    job = await repo.getNotification('job-lifecycle');
    expect(job?.recibidaObservadaEn).toBe('2026-10-15T12:00:01Z');

    // Segunda observación no sobreescribe la primera (COALESCE)
    await repo.recordNotificationObserved('job-lifecycle', '2026-10-15T12:00:05Z');
    job = await repo.getNotification('job-lifecycle');
    expect(job?.recibidaObservadaEn).toBe('2026-10-15T12:00:01Z');

    // 4. Registrar apertura (tap)
    await repo.recordNotificationOpened('job-lifecycle', '2026-10-15T12:05:00Z');
    job = await repo.getNotification('job-lifecycle');
    expect(job?.abiertaEn).toBe('2026-10-15T12:05:00Z');

    // Segunda apertura no sobreescribe la primera (idempotente)
    await repo.recordNotificationOpened('job-lifecycle', '2026-10-15T12:10:00Z');
    job = await repo.getNotification('job-lifecycle');
    expect(job?.abiertaEn).toBe('2026-10-15T12:05:00Z');
  });

  it('mantiene aislamiento estricto entre paciente A y paciente B en reglas y notificaciones', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repoA = createReminderRepository(db, patientA);
    const repoB = createReminderRepository(db, patientB);

    // Crear regla en A
    const ruleA = await repoA.saveRule({
      tipo: 'medicacion',
      medicamentoId: 'med-a-1',
      diasSemana: [1, 2],
      horasMinutos: ['08:00'],
      habilitado: true,
    });

    // Crear regla en B
    const ruleB = await repoB.saveRule({
      tipo: 'medicacion',
      medicamentoId: 'med-b-1',
      diasSemana: [3, 4],
      horasMinutos: ['12:00'],
      habilitado: true,
    });

    // Listar reglas de A no incluye las de B (y viceversa)
    const listA = await repoA.listRules();
    expect(listA.some((r) => r.id === ruleA.id)).toBe(true);
    expect(listA.some((r) => r.id === ruleB.id)).toBe(false);

    const listB = await repoB.listRules();
    expect(listB.some((r) => r.id === ruleB.id)).toBe(true);
    expect(listB.some((r) => r.id === ruleA.id)).toBe(false);

    // Intentar acceder directamente por ID cruzado devuelve null
    expect(await repoA.getRule(ruleB.id)).toBeNull();
    expect(await repoB.getRule(ruleA.id)).toBeNull();
  });

  it('obtiene una instantánea transaccional consistente en getReminderStatusSnapshot', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repoA = createReminderRepository(db, patientA, () => '2026-10-16T12:00:00.000Z');
    await repoA.setPreferences(true);

    const ruleVitals = await repoA.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['07:00'],
      habilitado: true,
    });
    await repoA.saveRule({
      tipo: 'medicacion',
      medicamentoId: 'med-a-1',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['19:00'],
      habilitado: true,
    });

    // Notificación pasada (no debe entrar en futureNotifications) y futura (sí debe entrar)
    await repoA.reserveOccurrence({
      id: 'notif-past',
      recordatorioId: ruleVitals.id,
      revision: ruleVitals.revision,
      tipo: 'registro_vitales',
      fechaPrevistaUtc: '2026-10-16T10:00:00.000Z',
      payload: {
        version: 1,
        notificacionId: 'notif-past',
        revision: ruleVitals.revision,
        pacienteId: patientA,
        recordatorioId: ruleVitals.id,
        tipo: 'registro_vitales',
        destino: '/vitales/registrar',
      },
    });
    await repoA.reserveOccurrence({
      id: 'notif-future',
      recordatorioId: ruleVitals.id,
      revision: ruleVitals.revision,
      tipo: 'registro_vitales',
      fechaPrevistaUtc: '2026-10-17T10:00:00.000Z',
      payload: {
        version: 1,
        notificacionId: 'notif-future',
        revision: ruleVitals.revision,
        pacienteId: patientA,
        recordatorioId: ruleVitals.id,
        tipo: 'registro_vitales',
        destino: '/vitales/registrar',
      },
    });

    const snapshot = await repoA.getReminderStatusSnapshot('2026-10-16T12:00:00.000Z');
    expect(snapshot.patientId).toBe(patientA);
    expect(snapshot.preferences.enabled).toBe(true);
    expect(snapshot.rules).toHaveLength(3); // incluye rule-template-vitales-a (deshabilitada) + 2 nuevas
    expect(snapshot.allEnabledRulesCount).toBe(2);
    expect(snapshot.futureNotifications.map((n) => n.id)).toEqual(['notif-future']);
  });

  it('T-13: saveRuleWithActivationIntent habilita preferencias si no hay otras reglas habilitadas, pero respeta la pausa general si existen otras', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA, () => '2026-10-16T12:00:00.000Z');

    // Caso 1: Preferencias apagadas y 0 reglas habilitadas -> save_and_activate levanta la preferencia general
    expect((await repo.getPreferences()).enabled).toBe(false);
    const firstActivation = await repo.saveRuleWithActivationIntent(
      {
        tipo: 'registro_vitales',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00'],
      },
      'save_and_activate',
    );
    expect(firstActivation.rule.habilitado).toBe(true);
    expect(firstActivation.preferencesEnabled).toBe(true);
    expect(firstActivation.resumedGeneralPreference).toBe(true);
    expect(firstActivation.pausedByGeneralPreference).toBe(false);
    expect(firstActivation.otherEnabledRulesCount).toBe(0);
    expect((await repo.getPreferences()).enabled).toBe(true);

    // Pausar todos los avisos dejando la primera regla habilitada individualmente
    await repo.setPreferences(false);

    // Caso 2: Pausa general activa y ya existe otra regla habilitada (registro_vitales) ->
    // save_and_activate en un medicamento guarda la regla pero NO reactiva silenciosamente las preferencias generales
    const secondActivation = await repo.saveRuleWithActivationIntent(
      {
        tipo: 'medicacion',
        medicamentoId: 'med-a-1',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00', '19:00'],
      },
      'save_and_activate',
    );
    expect(secondActivation.rule.habilitado).toBe(true);
    expect(secondActivation.preferencesEnabled).toBe(false);
    expect(secondActivation.resumedGeneralPreference).toBe(false);
    expect(secondActivation.pausedByGeneralPreference).toBe(true);
    expect(secondActivation.otherEnabledRulesCount).toBe(1);
    expect((await repo.getPreferences()).enabled).toBe(false);

    // Caso 3: Consentimiento explícito save_and_resume_all levanta la pausa general
    const resumed = await repo.saveRuleWithActivationIntent(
      {
        id: secondActivation.rule.id,
        tipo: 'medicacion',
        medicamentoId: 'med-a-1',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00', '19:00'],
      },
      'save_and_resume_all',
    );
    expect(resumed.preferencesEnabled).toBe(true);
    expect(resumed.resumedGeneralPreference).toBe(true);
    expect(resumed.pausedByGeneralPreference).toBe(false);
    expect((await repo.getPreferences()).enabled).toBe(true);
  });

  it('T-12 y T-15: hace rollback completo si falla la escritura en la transacción y nunca escribe en cola_envio', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA, () => '2026-10-16T12:00:00.000Z');
    const initialRulesCount = (await repo.listRules()).length;

    // Crear un trigger temporal que fuerce fallo al actualizar preferencia_avisos a 1
    await db.exec(`
      CREATE TRIGGER fail_pref_enable
      BEFORE UPDATE ON preferencia_avisos
      WHEN NEW.habilitado = 1
      BEGIN
        SELECT RAISE(ABORT, 'Fallo simulado al habilitar preferencia');
      END;
    `);

    await expect(
      repo.saveRuleWithActivationIntent(
        {
          tipo: 'registro_vitales',
          diasSemana: [1, 2, 3, 4, 5, 6, 7],
          horasMinutos: ['07:00'],
        },
        'save_and_activate',
      ),
    ).rejects.toThrow('Fallo simulado al habilitar preferencia');

    // Rollback completo: ni la regla nueva ni la preferencia quedaron guardadas
    expect(await repo.listRules()).toHaveLength(initialRulesCount);
    expect((await repo.getPreferences()).enabled).toBe(false);

    await db.exec('DROP TRIGGER fail_pref_enable;');

    // Ahora guardar normalmente y verificar que cola_envio sigue vacía (T-15)
    await repo.saveRuleWithActivationIntent(
      {
        tipo: 'registro_vitales',
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horasMinutos: ['07:00'],
      },
      'save_and_activate',
    );
    const outboxRow = await db.first<{ total: number }>(
      'SELECT count(*) AS total FROM cola_envio WHERE paciente_id = ?',
      [patientA],
    );
    expect(outboxRow?.total ?? 0).toBe(0);
  });
});
