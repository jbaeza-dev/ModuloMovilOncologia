import type { SqlConnection } from '../../data/local/core/sql';
import { createReminderRepository } from '../../data/local/reminders/reminder-repository';
import { generateUuid, type NotificationRecord } from '../../data/local/reminders/reminder-types';
import type {
  LocalNotificationAdapter,
  NotificationPermissionState,
} from '../notifications/notification-adapter';
import {
  calculateOccurrences,
  type MedicationContext,
  type OccurrenceCandidate,
} from './occurrence-scheduler';

export interface CoordinatorResult {
  status: 'programada' | 'desactivada' | 'permiso_denegado' | 'programacion_pendiente' | 'error';
  totalDeseadas: number;
  programadasConfirmadas: number;
  cubiertoHastaIso: string | null;
  truncadas: number;
  reglasAfectadas: string[];
  incidencias: string[];
  permission?: NotificationPermissionState;
}

/**
 * Mutex para serializar operaciones sobre la agenda y evitar condiciones de carrera.
 */
class CoordinatorMutex {
  private queue = Promise.resolve();

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}

export class NotificationCoordinator {
  private mutex = new CoordinatorMutex();

  constructor(
    private database: SqlConnection,
    private adapter: LocalNotificationAdapter,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Intenta resolver cancelaciones pendientes en el sistema operativo.
   * Retorna true si todas las cancelaciones fueron resueltas limpiamente.
   */
  async retryPendingCancellations(): Promise<{ resolved: boolean; remainingCount: number }> {
    const pendingJobs = await this.database.all<NotificationRecord>(
      "SELECT * FROM notificacion_local WHERE estado = 'cancelacion_pendiente'",
    );

    if (pendingJobs.length === 0) {
      return { resolved: true, remainingCount: 0 };
    }

    const scheduled = await this.adapter.listScheduled();
    const scheduledByNativeId = new Set(scheduled.map((s) => s.nativeId));
    let remaining = 0;

    for (const job of pendingJobs) {
      let cancelledOk = true;
      if (job.id_nativo && scheduledByNativeId.has(job.id_nativo)) {
        try {
          await this.adapter.cancel(job.id_nativo);
        } catch {
          cancelledOk = false;
        }
      }

      // También buscar por payload si no tiene id_nativo
      for (const item of scheduled) {
        if (item.payload?.notificacionId === job.id) {
          try {
            await this.adapter.cancel(item.nativeId);
          } catch {
            cancelledOk = false;
          }
        }
      }

      if (cancelledOk) {
        await this.database.run(
          "UPDATE notificacion_local SET estado = 'cancelada', actualizado_el = ? WHERE id = ?",
          [this.now(), job.id],
        );
      } else {
        remaining++;
      }
    }

    return { resolved: remaining === 0, remainingCount: remaining };
  }

  /**
   * Intenta cancelar todos los trabajos nativos de un paciente dado (ej. al cambiar de contexto A -> B).
   */
  async cancelPatientSchedule(
    patientId: string,
  ): Promise<{ success: boolean; pendingCount: number }> {
    return this.mutex.enqueue(async () => {
      const scheduled = await this.adapter.listScheduled();
      const patientJobs = scheduled.filter((s) => s.payload?.pacienteId === patientId);

      let pending = 0;
      for (const item of patientJobs) {
        try {
          await this.adapter.cancel(item.nativeId);
        } catch {
          pending++;
        }
      }

      const timestamp = this.now();
      if (pending > 0) {
        await this.database.run(
          `UPDATE notificacion_local
           SET estado = 'cancelacion_pendiente', actualizado_el = ?
           WHERE paciente_id = ? AND estado IN ('pendiente', 'programada')`,
          [timestamp, patientId],
        );
        return { success: false, pendingCount: pending };
      }

      await this.database.run(
        `UPDATE notificacion_local
         SET estado = 'cancelada', actualizado_el = ?
         WHERE paciente_id = ? AND estado IN ('pendiente', 'programada')`,
        [timestamp, patientId],
      );
      return { success: true, pendingCount: 0 };
    });
  }

  /**
   * Reconcilia la agenda de un paciente de manera determinista.
   */
  async reconcile(patientId: string): Promise<CoordinatorResult> {
    return this.mutex.enqueue(async () => {
      // 1. Reintentar resolver cancelaciones pendientes en esta misma reconciliación
      await this.retryPendingCancellations();

      // Verificar si persisten cancelaciones pendientes de OTRO paciente
      const foreignPending = await this.database.first<{ count: number }>(
        "SELECT count(*) as count FROM notificacion_local WHERE estado = 'cancelacion_pendiente' AND paciente_id != ?",
        [patientId],
      );

      if ((foreignPending?.count ?? 0) > 0) {
        return {
          status: 'programacion_pendiente',
          totalDeseadas: 0,
          programadasConfirmadas: 0,
          cubiertoHastaIso: null,
          truncadas: 0,
          reglasAfectadas: [],
          incidencias: [
            'La programación permanece pausada esperando resolver cancelaciones del contexto anterior.',
          ],
        };
      }

      const repo = createReminderRepository(this.database, patientId, this.now, generateUuid);
      const prefs = await repo.getPreferences();

      // Si las preferencias del paciente están desactivadas
      if (!prefs.enabled) {
        const scheduled = await this.adapter.listScheduled();
        for (const item of scheduled) {
          if (item.payload?.pacienteId === patientId) {
            try {
              await this.adapter.cancel(item.nativeId);
            } catch {
              // Ignorar
            }
          }
        }
        await this.database.run(
          `UPDATE notificacion_local
           SET estado = 'cancelada', actualizado_el = ?
           WHERE paciente_id = ? AND estado IN ('pendiente', 'programada')`,
          [this.now(), patientId],
        );
        return {
          status: 'desactivada',
          totalDeseadas: 0,
          programadasConfirmadas: 0,
          cubiertoHastaIso: null,
          truncadas: 0,
          reglasAfectadas: [],
          incidencias: [],
        };
      }

      // Consultar permiso nativo
      const permState = await this.adapter.getPermissionState();
      if (permState.status !== 'granted') {
        const scheduled = await this.adapter.listScheduled();
        for (const item of scheduled) {
          if (item.payload?.pacienteId === patientId) {
            try {
              await this.adapter.cancel(item.nativeId);
            } catch {
              // Ignorar
            }
          }
        }
        return {
          status: 'permiso_denegado',
          totalDeseadas: 0,
          programadasConfirmadas: 0,
          cubiertoHastaIso: null,
          truncadas: 0,
          reglasAfectadas: [],
          incidencias: ['Permiso de notificaciones no concedido en el sistema operativo.'],
          permission: permState,
        };
      }

      // 2. Calcular ocurrencias deseadas
      const rules = await repo.listRules();
      const medRows = await this.database.all<{
        id: string;
        nombre: string;
        fecha_inicio: string | null;
        fecha_fin: string | null;
        estado_activo: number;
      }>(
        'SELECT id, nombre, fecha_inicio, fecha_fin, estado_activo FROM medicamento_activo_cache WHERE paciente_id = ?',
        [patientId],
      );

      const medications: MedicationContext[] = medRows.map((m) => ({
        id: m.id,
        nombre: m.nombre,
        fechaInicio: m.fecha_inicio,
        fechaFin: m.fecha_fin,
        estadoActivo: m.estado_activo === 1,
      }));

      const plan = calculateOccurrences(rules, medications, {
        now: new Date(this.now()),
        idGenerator: generateUuid,
      });

      // 3. Obtener lista actual de trabajos nativos en el SO
      const allNative = await this.adapter.listScheduled();
      const patientNative = allNative.filter((s) => s.payload?.pacienteId === patientId);

      // Mapa de candidatos deseados por clave lógica
      // clave: `${recordatorioId}:${revision}:${fechaPrevistaUtc}`
      const desiredMap = new Map<string, OccurrenceCandidate>();
      for (const cand of plan.seleccionadas) {
        desiredMap.set(`${cand.recordatorioId}:${cand.revision}:${cand.fechaPrevistaUtc}`, cand);
      }

      // 4. Cancelar obsoletos, evaluar adopción condicionada y desempate de duplicados
      // Agrupar trabajos nativos por notificacionId
      const nativeByNotifId = new Map<string, typeof patientNative>();
      for (const item of patientNative) {
        const notifId = item.payload?.notificacionId;
        if (!notifId) {
          // Sin payload o inválido: cancelar
          try {
            await this.adapter.cancel(item.nativeId);
          } catch {
            // Ignorar fallo de cancelación si ya no existe en el SO
          }
          continue;
        }
        const group = nativeByNotifId.get(notifId) ?? [];
        group.push(item);
        nativeByNotifId.set(notifId, group);
      }

      const adoptedNativeIds = new Set<string>();

      for (const [notifId, group] of nativeByNotifId.entries()) {
        // Verificar si la fila existe en SQLite
        const dbJob = await this.database.first<NotificationRecord>(
          'SELECT * FROM notificacion_local WHERE paciente_id = ? AND id = ?',
          [patientId, notifId],
        );

        // Desempate de duplicados propios:
        let chosen = group[0];
        if (group.length > 1) {
          // Conservar el que coincide con id_nativo registrado en SQLite
          const matchingDb = group.find((g) => g.nativeId === dbJob?.id_nativo);
          if (matchingDb) {
            chosen = matchingDb;
          } else {
            // Desempate determinista lexicográfico
            chosen = [...group].sort((a, b) => a.nativeId.localeCompare(b.nativeId))[0];
          }
          // Cancelar los duplicados redundantes
          for (const item of group) {
            if (item.nativeId !== chosen.nativeId) {
              try {
                await this.adapter.cancel(item.nativeId);
              } catch {
                // Ignorar
              }
            }
          }
        }

        // Adopción condicionada:
        // Solo se adopta si existe en SQLite, pertenece al conjunto deseado vigente y no está en cancelacion_pendiente
        const candidateKey = `${chosen.payload?.recordatorioId}:${chosen.payload?.revision}:${chosen.triggerDateUtc}`;
        const isInDesiredSet = desiredMap.has(candidateKey);
        const isNotPendingCancel = dbJob?.estado !== 'cancelacion_pendiente';

        if (dbJob && isInDesiredSet && isNotPendingCancel) {
          // Adoptar
          await this.database.run(
            "UPDATE notificacion_local SET id_nativo = ?, estado = 'programada', error = NULL, actualizado_el = ? WHERE id = ?",
            [chosen.nativeId, this.now(), notifId],
          );
          adoptedNativeIds.add(chosen.nativeId);
          // Marcar como ya resuelta en el mapa deseado
          const candidate = desiredMap.get(candidateKey);
          if (candidate) {
            candidate.id = notifId; // Mantener ID consistente
          }
        } else {
          // No deseado o ya cancelado: cancelar del SO
          try {
            await this.adapter.cancel(chosen.nativeId);
          } catch {
            // Ignorar
          }
        }
      }

      // 5. Programar las ocurrencias restantes que no tengan trabajo nativo adoptado
      let confirmadas = 0;
      const incidencias: string[] = [];

      for (const cand of plan.seleccionadas) {
        // Consultar si ya tiene un trabajo programado activo en SQLite
        const existing = await this.database.first<NotificationRecord>(
          'SELECT * FROM notificacion_local WHERE paciente_id = ? AND recordatorio_id = ? AND revision = ? AND fecha_prevista_utc = ?',
          [patientId, cand.recordatorioId, cand.revision, cand.fechaPrevistaUtc],
        );

        if (existing?.estado === 'programada' && existing.id_nativo) {
          confirmadas++;
          continue;
        }

        const stableNotifId = existing?.id ?? cand.id;

        // Paso A: Reservar en SQLite como 'pendiente'
        await repo.reserveOccurrence({
          id: stableNotifId,
          recordatorioId: cand.recordatorioId,
          revision: cand.revision,
          tipo: cand.tipo,
          fechaPrevistaUtc: cand.fechaPrevistaUtc,
          payload: {
            version: 1,
            notificacionId: stableNotifId,
            revision: cand.revision,
            pacienteId: patientId,
            recordatorioId: cand.recordatorioId,
            tipo: cand.tipo,
            medicamentoId: cand.medicamentoId,
            destino: cand.tipo === 'registro_vitales' ? '/vitales/registrar' : '/perfil/medicacion',
          },
        });

        // Paso B: Programar en el SO
        let nativeId: string;
        try {
          const res = await this.adapter.schedule({
            triggerDateUtc: cand.fechaPrevistaUtc,
            title: 'Tienes un recordatorio en QuimioCare',
            body: 'Ingresa a la aplicación para revisar tu seguimiento diario.',
            payload: {
              version: 1,
              notificacionId: stableNotifId,
              revision: cand.revision,
              pacienteId: patientId,
              recordatorioId: cand.recordatorioId,
              tipo: cand.tipo,
              medicamentoId: cand.medicamentoId,
              destino:
                cand.tipo === 'registro_vitales' ? '/vitales/registrar' : '/perfil/medicacion',
            },
          });
          nativeId = res.nativeId;
        } catch (scheduleErr) {
          await repo.markNotificationError(stableNotifId, (scheduleErr as Error).message);
          incidencias.push(
            `Fallo al programar en el sistema operativo: ${(scheduleErr as Error).message}`,
          );
          continue;
        }

        // Paso C: Persistir id_nativo en SQLite (con rollback compensatorio)
        try {
          await repo.markNotificationScheduled(stableNotifId, nativeId);
          confirmadas++;
        } catch {
          // Compensación inmediata: cancelar en el SO
          try {
            await this.adapter.cancel(nativeId);
          } catch {
            // Ignorar
          }
          incidencias.push('Fallo de persistencia en SQLite; trabajo nativo compensado.');
        }
      }

      return {
        status: 'programada',
        totalDeseadas: plan.totalCalculadas,
        programadasConfirmadas: confirmadas,
        cubiertoHastaIso: plan.cubiertoHastaIso,
        truncadas: plan.truncadas,
        reglasAfectadas: plan.reglasAfectadas,
        incidencias,
        permission: permState,
      };
    });
  }
}
