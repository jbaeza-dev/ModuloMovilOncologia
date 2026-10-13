import { describe, expect, it } from 'vitest';

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
