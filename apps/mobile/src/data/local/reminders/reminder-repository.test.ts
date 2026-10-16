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
});
