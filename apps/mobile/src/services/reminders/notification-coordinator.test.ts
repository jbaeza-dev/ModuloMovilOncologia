import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../../data/local/migrations';
import { createReminderRepository } from '../../data/local/reminders/reminder-repository';
import { seedPatientContextIfEmpty } from '../../data/local/repository';
import {
  createSqliteTestHarness,
  patientA,
  patientB,
} from '../../data/local/testing/sqlite-test-harness';
import { FakeNotificationAdapter } from '../notifications/notification-adapter';
import { NotificationCoordinator } from './notification-coordinator';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('NotificationCoordinator', () => {
  it('cancela trabajos nativos y retorna desactivada si las preferencias del paciente están deshabilitadas', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter);

    // Por defecto las preferencias están deshabilitadas
    const res = await coordinator.reconcile(patientA);
    expect(res.status).toBe('desactivada');
    expect(res.programadasConfirmadas).toBe(0);
    expect(adapter.scheduled.size).toBe(0);
  });

  it('cancela trabajos y retorna permiso_denegado si el SO no tiene permiso concedido', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);
    await repo.setPreferences(true);

    const adapter = new FakeNotificationAdapter();
    adapter.permission = { status: 'denied', canAskAgain: false, channelStatus: 'ok' };
    const coordinator = new NotificationCoordinator(db, adapter);

    const res = await coordinator.reconcile(patientA);
    expect(res.status).toBe('permiso_denegado');
    expect(res.programadasConfirmadas).toBe(0);
    expect(adapter.scheduled.size).toBe(0);
  });

  it('programa ocurrencias deterministas con contenido genérico cuando preferencias y permisos están activos', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);
    await repo.setPreferences(true);
    await repo.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['09:00'],
      habilitado: true,
    });

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');

    const res = await coordinator.reconcile(patientA);
    expect(res.status).toBe('programada');
    expect(res.programadasConfirmadas).toBeGreaterThan(0);
    expect(adapter.scheduled.size).toBe(res.programadasConfirmadas);

    // Verificar que el payload contiene notificacionId y revision
    const firstScheduled = Array.from(adapter.scheduled.values())[0];
    expect(firstScheduled.payload?.pacienteId).toBe(patientA);
    expect(firstScheduled.payload?.notificacionId).toBeDefined();
    expect(firstScheduled.payload?.revision).toBe(1);
    expect(firstScheduled.payload?.tipo).toBe('registro_vitales');
  });

  it('adopta trabajos nativos existentes que coinciden con el conjunto deseado sin duplicar', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);
    await repo.setPreferences(true);
    await repo.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['09:00'],
      habilitado: true,
    });

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');

    // Primera reconciliación: programa
    await coordinator.reconcile(patientA);
    const count1 = adapter.scheduled.size;
    expect(count1).toBeGreaterThan(0);

    // Segunda reconciliación inmediata: adopta los existentes sin duplicar alarmas
    const res2 = await coordinator.reconcile(patientA);
    expect(res2.status).toBe('programada');
    expect(adapter.scheduled.size).toBe(count1);
  });

  it('desempata duplicados en el SO conservando una sola notificación nativa', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);
    await repo.setPreferences(true);
    await repo.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['09:00'],
      habilitado: true,
    });

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');

    await coordinator.reconcile(patientA);

    // Simular que en el SO se duplicó una notificación manualmente (2 trabajos con el mismo notificacionId)
    const existing = Array.from(adapter.scheduled.values())[0];
    adapter.scheduled.set('fake-duplicate-id', {
      nativeId: 'fake-duplicate-id',
      triggerDateUtc: existing.triggerDateUtc,
      payload: { ...existing.payload! },
    });
    expect(adapter.scheduled.size).toBeGreaterThan(1);

    // Al reconciliar, debe detectar el duplicado propio y cancelar el sobrante
    await coordinator.reconcile(patientA);

    const withSameNotifId = Array.from(adapter.scheduled.values()).filter(
      (s) => s.payload?.notificacionId === existing.payload?.notificacionId,
    );
    expect(withSameNotifId).toHaveLength(1);
  });

  it('pausa a B si A tiene cancelaciones pendientes; reintenta cancelaciones en la reconciliación y desbloquea a B', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repoA = createReminderRepository(db, patientA);
    await repoA.setPreferences(true);
    await repoA.saveRule({
      tipo: 'registro_vitales',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['09:00'],
      habilitado: true,
    });

    const adapter = new FakeNotificationAdapter();
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');

    // Programar para A
    await coordinator.reconcile(patientA);
    expect(adapter.scheduled.size).toBeGreaterThan(0);

    // Simular que al cambiar a B falla la cancelación nativa de A
    adapter.shouldFailCancel = true;
    const cancelRes = await coordinator.cancelPatientSchedule(patientA);
    expect(cancelRes.success).toBe(false);
    expect(cancelRes.pendingCount).toBeGreaterThan(0);

    // Preparar B
    const repoB = createReminderRepository(db, patientB);
    await repoB.setPreferences(true);
    await repoB.saveRule({
      tipo: 'medicacion',
      medicamentoId: 'med-b-1',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['12:00'],
      habilitado: true,
    });

    // Reconciliar B mientras la cancelación de A sigue fallando -> debe pausar con 'programacion_pendiente'
    const resBPause = await coordinator.reconcile(patientB);
    expect(resBPause.status).toBe('programacion_pendiente');

    // Ahora la cancelación del SO se recupera
    adapter.shouldFailCancel = false;

    // Al reintentar la reconciliación de B: primero resuelve las cancelaciones de A y luego programa B
    const resBSuccess = await coordinator.reconcile(patientB);
    expect(resBSuccess.status).toBe('programada');
    expect(resBSuccess.programadasConfirmadas).toBeGreaterThan(0);

    // Ninguna notificación en el SO pertenece a A
    const allScheduled = Array.from(adapter.scheduled.values());
    expect(allScheduled.every((s) => s.payload?.pacienteId === patientB)).toBe(true);
  });
});
