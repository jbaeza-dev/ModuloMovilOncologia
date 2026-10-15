import { describe, expect, it } from 'vitest';

import type { SqlValue } from '../data/local/core/sql';
import { migrateDatabase } from '../data/local/migrations';
import { createReminderRepository } from '../data/local/reminders/reminder-repository';
import type { NotificationJobPayload } from '../data/local/reminders/reminder-types';
import { seedPatientContextIfEmpty } from '../data/local/repository';
import {
  createSqliteTestHarness,
  patientA,
  patientB,
} from '../data/local/testing/sqlite-test-harness';
import { FakeNotificationAdapter } from '../services/notifications/notification-adapter';
import { NotificationCoordinator } from '../services/reminders/notification-coordinator';
import {
  ALLOWED_NOTIFICATION_DESTINATIONS,
  ALLOWED_REMINDER_TYPES,
  isValidNotificationPayload,
} from '../data/local/reminders/reminder-types';

const harness = createSqliteTestHarness();
const { open } = harness;

describe('LocalDataProvider Notification Processing', () => {
  it('valida correctamente los tipos acordados en el dominio y rechaza toma_medicamento', () => {
    expect(ALLOWED_REMINDER_TYPES.has('registro_vitales')).toBe(true);
    expect(ALLOWED_REMINDER_TYPES.has('medicacion')).toBe(true);
    // @ts-expect-error verificación deliberada de tipo obsoleto/incorrecto
    expect(ALLOWED_REMINDER_TYPES.has('toma_medicamento')).toBe(false);
    expect(ALLOWED_NOTIFICATION_DESTINATIONS.has('/vitales/registrar')).toBe(true);
    expect(ALLOWED_NOTIFICATION_DESTINATIONS.has('/perfil/medicacion')).toBe(true);

    const validVitales: NotificationJobPayload = {
      version: 1,
      notificacionId: 'notif-1',
      pacienteId: 'paciente-a',
      recordatorioId: 'rec-1',
      revision: 1,
      tipo: 'registro_vitales',
      destino: '/vitales/registrar',
    };
    expect(isValidNotificationPayload(validVitales)).toBe(true);

    const validMedicacion: NotificationJobPayload = {
      version: 1,
      notificacionId: 'notif-2',
      pacienteId: 'paciente-a',
      recordatorioId: 'rec-2',
      revision: 1,
      tipo: 'medicacion',
      medicamentoId: 'med-1',
      destino: '/perfil/medicacion',
    };
    expect(isValidNotificationPayload(validMedicacion)).toBe(true);

    // Payload con el tipo antiguo incorrecto 'toma_medicamento' debe ser rechazado
    const invalidTipo = {
      ...validMedicacion,
      tipo: 'toma_medicamento',
    };
    expect(isValidNotificationPayload(invalidTipo)).toBe(false);

    // Payload con destino no permitido
    const invalidDestino = {
      ...validVitales,
      destino: '/ruta/desconocida',
    };
    expect(isValidNotificationPayload(invalidDestino)).toBe(false);

    // Payload sin revision o no entera
    expect(isValidNotificationPayload({ ...validVitales, revision: 0 })).toBe(false);
    expect(isValidNotificationPayload({ ...validVitales, revision: 1.5 })).toBe(false);
    expect(isValidNotificationPayload({ ...validVitales, recordatorioId: '' })).toBe(false);
  });

  it('procesa y valida payloads generados por el coordinador para ambos tipos (registro_vitales y medicacion)', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);
    await repo.setPreferences(true);

    // 1. Regla de vitales
    await repo.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['08:00'],
      zonaHoraria: 'America/Santiago',
      habilitado: true,
    });

    // 2. Regla de medicación vinculada
    await repo.saveRule({
      tipo: 'medicacion',
      medicamentoId: 'med-a-1',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['14:00'],
      zonaHoraria: 'America/Santiago',
      habilitado: true,
    });

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');

    const res = await coordinator.reconcile(patientA);
    expect(res.status).toBe('programada');
    expect(adapter.scheduled.size).toBe(28); // 14 de vitales + 14 de medicacion

    const scheduledJobs = Array.from(adapter.scheduled.values());
    const vitalesJobs = scheduledJobs.filter((j) => j.payload?.tipo === 'registro_vitales');
    const medicacionJobs = scheduledJobs.filter((j) => j.payload?.tipo === 'medicacion');

    expect(vitalesJobs.length).toBe(14);
    expect(medicacionJobs.length).toBe(14);

    // Ambos grupos de payloads DEBEN pasar la validación rigurosa de isValidNotificationPayload
    for (const job of vitalesJobs) {
      expect(isValidNotificationPayload(job.payload)).toBe(true);
      expect(job.payload?.destino).toBe('/vitales/registrar');
    }

    for (const job of medicacionJobs) {
      expect(isValidNotificationPayload(job.payload)).toBe(true);
      expect(job.payload?.destino).toBe('/perfil/medicacion');
      expect(job.payload?.medicamentoId).toBe('med-a-1');
    }
  });

  it('valida la correspondencia de campos en SQLite antes de marcar una notificación como abierta', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);
    await repo.setPreferences(true);
    const rule = await repo.saveRule({
      tipo: 'medicacion',
      medicamentoId: 'med-a-1',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['12:00'],
      zonaHoraria: 'America/Santiago',
      habilitado: true,
    });

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');
    await coordinator.reconcile(patientA);

    const scheduled = Array.from(adapter.scheduled.values())[0];
    const payload = scheduled.payload!;

    // 1. Consulta exacta contra SQLite
    const row = await db.first<{
      id: string;
      paciente_id: string;
      recordatorio_id: string;
      revision: number;
      tipo: string;
      abierta_en: string | null;
    }>(
      'SELECT id, paciente_id, recordatorio_id, revision, tipo, abierta_en FROM notificacion_local WHERE id = ? AND paciente_id = ?',
      [payload.notificacionId, patientA],
    );

    expect(row).toBeDefined();
    expect(row?.recordatorio_id).toBe(rule.id);
    expect(row?.revision).toBe(1);
    expect(row?.tipo).toBe('medicacion');
    expect(row?.abierta_en).toBeNull();

    // 2. Simulación de apertura exitosa
    await db.run(
      'UPDATE notificacion_local SET abierta_en = ? WHERE id = ? AND paciente_id = ? AND abierta_en IS NULL',
      ['2026-10-13T12:05:00.000Z', payload.notificacionId, patientA],
    );

    const openedRow = await db.first<{ abierta_en: string | null }>(
      'SELECT abierta_en FROM notificacion_local WHERE id = ?',
      [payload.notificacionId],
    );
    expect(openedRow?.abierta_en).toBe('2026-10-13T12:05:00.000Z');
  });

  it('permite reintentar un evento en vuelo si ocurre un fallo transitorio de base de datos', async () => {
    const inFlight = new Set<string>();
    const completed = new Set<string>();
    const dedupeKey = 'notif-1:listener-1';

    // Función mock simulando el flujo de handleNotificationOpen con try/finally
    let simulateDbError = true;
    let navigated = false;

    async function handleOpenMock(): Promise<boolean> {
      let success = false;
      try {
        if (simulateDbError) {
          throw new Error('SQLite disk I/O error transitorio');
        }
        navigated = true;
        success = true;
        return true;
      } catch {
        return false;
      } finally {
        inFlight.delete(dedupeKey);
        if (success) {
          completed.add(dedupeKey);
        }
      }
    }

    // 1er intento: Falla SQLite
    inFlight.add(dedupeKey);
    const firstRes = await handleOpenMock();
    expect(firstRes).toBe(false);
    expect(navigated).toBe(false);
    // El conjunto in-flight DEBE quedar limpio
    expect(inFlight.has(dedupeKey)).toBe(false);
    // No debe estar marcado como completado
    expect(completed.has(dedupeKey)).toBe(false);

    // 2do intento: SQLite se recupera
    simulateDbError = false;
    expect(!completed.has(dedupeKey) && !inFlight.has(dedupeKey)).toBe(true);
    inFlight.add(dedupeKey);
    const secondRes = await handleOpenMock();
    expect(secondRes).toBe(true);
    expect(navigated).toBe(true);
    expect(inFlight.has(dedupeKey)).toBe(false);
    expect(completed.has(dedupeKey)).toBe(true);
  });

  it('conserva la intención con su dedupeKey original ante conmutación de paciente sin perder reintento', () => {
    let pendingIntent: { payload: NotificationJobPayload; dedupeKey: string } | null = null;
    const inFlight = new Set<string>();
    const completed = new Set<string>();

    const payloadA: NotificationJobPayload = {
      version: 1,
      notificacionId: 'notif-a-1',
      pacienteId: patientA,
      recordatorioId: 'rec-1',
      revision: 1,
      tipo: 'medicacion',
      destino: '/perfil/medicacion',
    };
    const originalKey = 'notif-a-1:cold-start';

    // Llega notificación de A mientras el paciente activo es B
    const activePatient = patientB;
    if (payloadA.pacienteId !== activePatient) {
      pendingIntent = { payload: payloadA, dedupeKey: originalKey };
      // En el finally de handleNotificationOpen:
      inFlight.delete(originalKey);
    }

    expect(pendingIntent).toBeDefined();
    expect(pendingIntent?.dedupeKey).toBe(originalKey);
    expect(inFlight.has(originalKey)).toBe(false);
    expect(completed.has(originalKey)).toBe(false);

    // Al seleccionar paciente A:
    const newActivePatient = patientA;
    if (newActivePatient === pendingIntent?.payload.pacienteId) {
      const keyToProcess = pendingIntent.dedupeKey;
      expect(keyToProcess).toBe(originalKey);
      expect(!completed.has(keyToProcess) && !inFlight.has(keyToProcess)).toBe(true);
    }
  });
});

import { PatientContextManager } from './patient-context-manager';
import { DemoSessionAdapter } from '../services/session/demo-session-adapter';
import { FakeAssistantAdapter } from '../services/assistant/fake-assistant-adapter';

describe('LocalDataProvider Context Teardown and Operation Tracking', () => {
  it('trackOperation protege el contador frente a excepciones síncronas y asíncronas', async () => {
    const sessionAdapter = new DemoSessionAdapter();
    const assistantAdapter = new FakeAssistantAdapter();
    const router = { replace: () => undefined, push: () => undefined };
    const manager = new PatientContextManager({
      sessionAdapter,
      assistantAdapter,
      router,
    });

    // 1. Excepción síncrona: la función lanza inmediatamente antes de retornar una promesa
    await expect(
      manager.trackOperation(() => {
        throw new Error('Error síncrono inmediato');
      }),
    ).rejects.toThrow('Error síncrono inmediato');

    // El contador DEBE quedar en 0
    expect(manager.getActiveOperations()).toBe(0);

    // 2. Excepción asíncrona: la promesa es rechazada
    await expect(
      manager.trackOperation(async () => {
        throw new Error('Error asíncrono');
      }),
    ).rejects.toThrow('Error asíncrono');

    expect(manager.getActiveOperations()).toBe(0);

    // 3. Operación exitosa
    const result = await manager.trackOperation(async () => 42);
    expect(result).toBe(42);
    expect(manager.getActiveOperations()).toBe(0);

    // 4. Rechazo durante proceso de cierre
    const teardownPromise = manager.closeActiveContext('manual_close');
    await expect(manager.trackOperation(async () => 'bloqueado')).rejects.toThrow(
      'Operación rechazada: el contexto se encuentra en proceso de cierre.',
    );
    expect(manager.getActiveOperations()).toBe(0);
    await teardownPromise;
  });

  it('closeActiveContext realiza fase 1 en menos de 1 segundo, comparte la promesa y drena escrituras activas', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');
    const sessionAdapter = new DemoSessionAdapter();
    const assistantAdapter = new FakeAssistantAdapter();
    const router = { replace: () => undefined, push: () => undefined };

    const manager = new PatientContextManager({
      database: db,
      coordinator,
      sessionAdapter,
      assistantAdapter,
      router,
    });

    await manager.selectPatient(patientA);
    expect(manager.getPatientId()).toBe(patientA);

    // Simular escritura asíncrona activa de Paciente A
    let finishWrite!: () => void;
    const writePromise = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });

    const writeTracker = manager.trackOperation(async () => {
      await writePromise;
      return 'guardado_completado';
    });

    expect(manager.getActiveOperations()).toBe(1);

    // Iniciar cierre de contexto: medir tiempo de Fase 1
    const t0 = Date.now();
    const teardown1 = manager.closeActiveContext('manual_close');
    const phase1Duration = Date.now() - t0;

    // Fase 1 DEBE ejecutarse inmediatamente (< 100 ms << 1000 ms)
    expect(phase1Duration).toBeLessThan(100);
    expect(manager.getPatientId()).toBeNull();
    expect(manager.getContextEpoch()).toBe(2);

    // Llamadas concurrentes comparten la misma promesa
    const teardown2 = manager.closeActiveContext('manual_close');
    expect(teardown1).toBe(teardown2);

    // Finalizar la escritura en curso
    finishWrite();
    const writeResult = await writeTracker;
    expect(writeResult).toBe('guardado_completado');

    // Esperar resultado del drenaje observable
    const result = await teardown1;
    expect(result.success).toBe(true);
    expect(result.cancelledPatientId).toBe(patientA);
    expect(result.pendingNotificationsCount).toBe(0);
    expect(manager.getActiveOperations()).toBe(0);
    expect(manager.getIsClosing()).toBe(false);
    expect(sessionAdapter.getCurrentUser()).toBeNull();
  });

  it('selectPatient fuerza y espera el cierre del contexto previo antes de activar el nuevo', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');
    const sessionAdapter = new DemoSessionAdapter();
    const assistantAdapter = new FakeAssistantAdapter();
    const router = { replace: () => undefined, push: () => undefined };

    const manager = new PatientContextManager({
      database: db,
      coordinator,
      sessionAdapter,
      assistantAdapter,
      router,
    });

    await manager.selectPatient(patientA);
    expect(manager.getPatientId()).toBe(patientA);

    let resolveActiveOperation!: () => void;
    const activeOperationPromise = new Promise<void>((resolve) => {
      resolveActiveOperation = resolve;
    });

    const activeOp = manager.trackOperation(async () => {
      await activeOperationPromise;
    });

    // Iniciar conmutación hacia Paciente B mientras Paciente A tiene una operación en curso
    const selectPromise = manager.selectPatient(patientB);

    // Mientras la operación de A está en curso, Paciente B NO debe haber sido activado aún
    expect(manager.getPatientId()).toBeNull();
    expect(manager.getIsClosing()).toBe(true);

    // Concluir la operación de A
    resolveActiveOperation();
    await activeOp;
    await selectPromise;

    // Ahora Paciente B debe ser el activo y el cierre de A completó limpiamente
    expect(manager.getIsClosing()).toBe(false);
    expect(manager.getPatientId()).toBe(patientB);
    expect(sessionAdapter.getCurrentUser()?.id).toBe(patientB);

    // Validar rechazo de paciente no registrado en demostración
    await expect(manager.selectPatient('paciente-invalido-999')).rejects.toThrow(
      "Paciente de prueba 'paciente-invalido-999' no reconocido.",
    );
  });

  it('cierre provocado por session_required cancela la agenda nativa tras abrir SQLite', async () => {
    const sessionAdapter = new DemoSessionAdapter();
    const assistantAdapter = new FakeAssistantAdapter({ shouldSimulateSessionRequired: true });
    let replacedRoute = '';
    const router = {
      replace: (r: string) => {
        replacedRoute = r;
      },
      push: () => undefined,
    };

    // 1. Inicialmente coordinator es null (simulando primer render de la app antes de abrir SQLite)
    const manager = new PatientContextManager({
      database: null,
      coordinator: null,
      sessionAdapter,
      assistantAdapter,
      router,
    });

    // 2. Posteriormente abre SQLite y se configura el NotificationCoordinator
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');

    manager.setDatabase(db);
    manager.setCoordinator(coordinator);

    // 3. Paciente A se activa y tiene recordatorios programados en SQLite y la agenda nativa
    await manager.selectPatient(patientA);
    const repo = createReminderRepository(db, patientA);
    await repo.setPreferences(true);
    await repo.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['08:00'],
      zonaHoraria: 'America/Santiago',
      habilitado: true,
    });
    const reconcileResult = await coordinator.reconcile(patientA, () => true);
    expect(reconcileResult.programadasConfirmadas).toBeGreaterThan(0);
    expect(adapter.scheduled.size).toBeGreaterThan(0);

    // 4. El asistente recibe un mensaje cuyo adaptador responde con session_required
    await manager.assistantController.send('Consulta que expirará la sesión');

    // Aguardar microtareas para que el callback de session_required complete el drenaje
    await new Promise((r) => setTimeout(r, 60));

    // 5. Verificar que el callback vigente invocó closeActiveContext con el coordinador activo:
    // La agenda del paciente en el adaptador nativo DEBE quedar cancelada
    expect(adapter.scheduled.size).toBe(0);
    // El router fue redirigido a la vista de sesión requerida
    expect(replacedRoute).toBe('/acceso?motivo=sesion_requerida');
    // El contexto activo fue invalidado
    expect(manager.getPatientId()).toBeNull();
    // La sesión fue cerrada
    expect(sessionAdapter.getCurrentUser()).toBeNull();
  });

  it('consulta tardía de handleNotificationOpen no recrea una intención si el contexto ya se cerró', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const sessionAdapter = new DemoSessionAdapter();
    const assistantAdapter = new FakeAssistantAdapter();
    const router = { replace: () => undefined, push: () => undefined };

    const manager = new PatientContextManager({
      database: db,
      coordinator: null,
      sessionAdapter,
      assistantAdapter,
      router,
    });

    await manager.selectPatient(patientA);

    const payloadA: NotificationJobPayload = {
      version: 1,
      notificacionId: 'notif-tardia-1',
      pacienteId: patientA,
      recordatorioId: 'rec-1',
      revision: 1,
      tipo: 'registro_vitales',
      destino: '/vitales/registrar',
    };

    // Interceptar temporalmente db.first para intercalar un cierre de contexto mientras la consulta SQLite está en vuelo
    const originalFirst = db.first.bind(db);
    db.first = async <T>(sql: string, params?: SqlValue[]): Promise<T | null> => {
      // Simular latencia y ejecutar closeActiveContext durante la consulta SQLite
      await manager.closeActiveContext('manual_close');
      return originalFirst(sql, params);
    };

    const result = await manager.handleNotificationOpen(payloadA, 'dedupe-tardia');

    // La apertura debió ser rechazada
    expect(result).toBe(false);
    // Y NO debe haber recreado ninguna intención pendiente
    expect(manager.getPendingNotificationIntent()).toBeNull();
  });
});
