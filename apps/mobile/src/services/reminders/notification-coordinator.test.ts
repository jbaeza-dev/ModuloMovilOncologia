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

  it('reporta error y registra incidencia si falla la consulta de la agenda nativa (listScheduled)', async () => {
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
    adapter.shouldFailList = true;
    const coordinator = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');

    const res = await coordinator.reconcile(patientA);
    expect(res.status).toBe('error');
    expect(res.incidencias.length).toBeGreaterThan(0);
    expect(res.incidencias[0]).toContain('consulta');
  });

  it('detecta agenda desaparecida en el SO y reprograma conservando UUIDs en lugar de confirmar falsamente', async () => {
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

    // 1. Programar inicialmente
    const res1 = await coordinator.reconcile(patientA);
    expect(res1.status).toBe('programada');
    expect(adapter.scheduled.size).toBeGreaterThan(0);

    // Obtener los UUIDs de SQLite
    const rowsBefore = await db.all<{ id: string }>(
      'SELECT id FROM notificacion_local WHERE paciente_id = ? AND estado = ?',
      [patientA, 'programada'],
    );
    const originalIds = new Set(rowsBefore.map((r) => r.id));

    // 2. Simular vaciado repentino de la agenda en el SO (reinicio o force-stop) conservando SQLite
    adapter.scheduled.clear();
    expect(adapter.scheduled.size).toBe(0);

    // 3. Reconciliar nuevamente: el coordinador NO debe confirmar 14 si hay 0 en el SO; debe reprogramar
    const res2 = await coordinator.reconcile(patientA);
    expect(res2.status).toBe('programada');
    expect(adapter.scheduled.size).toBe(res2.programadasConfirmadas);
    expect(adapter.scheduled.size).toBeGreaterThan(0);

    // Los UUIDs reprogramados deben conservar los mismos identificadores estables
    for (const item of adapter.scheduled.values()) {
      expect(originalIds.has(item.payload?.notificacionId ?? '')).toBe(true);
    }
  });

  it('retorna permiso_denegado si el canal de notificaciones está bloqueado (channelStatus: blocked)', async () => {
    const db = open();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const repo = createReminderRepository(db, patientA);
    await repo.setPreferences(true);

    const adapter = new FakeNotificationAdapter();
    adapter.permission = { status: 'granted', canAskAgain: true, channelStatus: 'blocked' };
    const coordinator = new NotificationCoordinator(db, adapter);

    const res = await coordinator.reconcile(patientA);
    expect(res.status).toBe('permiso_denegado');
  });

  it('transiciona ocurrencias pasadas no observadas a finalizada_sin_observacion', async () => {
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
    // 1. Reconciliar el 10 de octubre de 2026
    const coord1 = new NotificationCoordinator(db, adapter, () => '2026-10-10T00:00:00Z');
    await coord1.reconcile(patientA);

    // 2. Avanzar el tiempo al 13 de octubre de 2026 y volver a reconciliar
    const coord2 = new NotificationCoordinator(db, adapter, () => '2026-10-13T00:00:00Z');
    await coord2.reconcile(patientA);

    // 3. Verificar que las ocurrencias de días anteriores pasaron a 'finalizada_sin_observacion'
    const pastRows = await db.all<{ estado: string }>(
      "SELECT estado FROM notificacion_local WHERE paciente_id = ? AND fecha_prevista_utc < '2026-10-13T00:00:00Z'",
      [patientA],
    );
    expect(pastRows.length).toBeGreaterThan(0);
    expect(pastRows.every((r) => r.estado === 'finalizada_sin_observacion')).toBe(true);
  });

  it('conserva cancelacion_pendiente en SQLite si falla la cancelación al desactivar preferencias', async () => {
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

    // 1. Programar
    await coordinator.reconcile(patientA);
    expect(adapter.scheduled.size).toBeGreaterThan(0);

    // 2. Desactivar preferencias en SQLite y hacer que falle el cancel nativo
    await repo.setPreferences(false);
    adapter.shouldFailCancel = true;

    const res = await coordinator.reconcile(patientA);
    expect(res.status).toBe('programacion_pendiente');

    // Filas en SQLite deben estar como 'cancelacion_pendiente', NO como 'cancelada'
    const pendingRows = await db.all<{ id: string }>(
      'SELECT id FROM notificacion_local WHERE paciente_id = ? AND estado = ?',
      [patientA, 'cancelacion_pendiente'],
    );
    expect(pendingRows.length).toBeGreaterThan(0);
  });
});
