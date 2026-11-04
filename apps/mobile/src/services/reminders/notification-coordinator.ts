import type { SqlConnection } from '../../data/local/core/sql';
import { reminderNotificationCopy } from '../notifications/notification-copy';
import { createReminderRepository } from '../../data/local/reminders/reminder-repository';
import { generateUuid, type NotificationRecord } from '../../data/local/reminders/reminder-types';
import type {
  LocalNotificationAdapter,
  NotificationPermissionState,
  ScheduledNotificationItem,
} from '../notifications/notification-adapter';
import {
  calculateOccurrences,
  type MedicationContext,
  type OccurrenceCandidate,
} from './occurrence-scheduler';

export interface CoordinatorResult {
  status: 'programada' | 'desactivada' | 'permiso_denegado' | 'programacion_pendiente' | 'error';
  motivoPendiente?: 'contexto_anterior' | 'cancelacion_regla_previa' | 'programacion_parcial';
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
export class CoordinatorMutex {
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

export const defaultCoordinatorMutex = new CoordinatorMutex();

export class NotificationCoordinator {
  private mutex: CoordinatorMutex;

  constructor(
    private database: SqlConnection,
    private adapter: LocalNotificationAdapter,
    private now: () => string = () => new Date().toISOString(),
    mutex?: CoordinatorMutex,
    private getActivePatientId?: () => string | null,
  ) {
    this.mutex = mutex ?? defaultCoordinatorMutex;
  }

  /**
   * Resuelve la cancelación de una ocurrencia lógica cancelando todos sus trabajos nativos asociados.
   * Si cualquiera falla, la fila permanece o pasa a 'cancelacion_pendiente'.
   * Si todos se cancelan con éxito (o no existía ninguno en el SO), pasa a 'cancelada'.
   */
  private async cancelOccurrenceJobs(
    notifId: string,
    nativeItems: readonly ScheduledNotificationItem[],
  ): Promise<{ success: boolean; error?: Error }> {
    let allCancelled = true;
    let lastError: Error | undefined;

    for (const item of nativeItems) {
      try {
        await this.adapter.cancel(item.nativeId);
      } catch (err) {
        allCancelled = false;
        lastError = err as Error;
      }
    }

    const timestamp = this.now();
    if (!allCancelled) {
      await this.database.run(
        `UPDATE notificacion_local
         SET estado = 'cancelacion_pendiente', error = ?, actualizado_el = ?
         WHERE id = ?`,
        [lastError?.message ?? 'Fallo al cancelar trabajo nativo en el SO', timestamp, notifId],
      );
      return { success: false, error: lastError };
    }

    await this.database.run(
      `UPDATE notificacion_local
       SET estado = CASE WHEN estado IN ('pendiente', 'programada', 'cancelacion_pendiente') THEN 'cancelada' ELSE estado END,
           id_nativo = NULL,
           error = NULL,
           actualizado_el = ?
       WHERE id = ?`,
      [timestamp, notifId],
    );
    return { success: true };
  }

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

    let scheduled: readonly ScheduledNotificationItem[];
    try {
      scheduled = await this.adapter.listScheduled();
    } catch {
      return { resolved: false, remainingCount: pendingJobs.length };
    }

    let remaining = 0;

    for (const job of pendingJobs) {
      // Buscar todos los trabajos en el SO asociados a esta notificación
      const matchingNative = scheduled.filter(
        (s) =>
          s.payload?.notificacionId === job.id ||
          (Boolean(job.id_nativo) && s.nativeId === job.id_nativo),
      );

      const res = await this.cancelOccurrenceJobs(job.id, matchingNative);
      if (!res.success) {
        remaining++;
      }
    }

    return { resolved: remaining === 0, remainingCount: remaining };
  }

  /**
   * Implementación interna para cancelar la agenda completa de un paciente.
   * Agrupa los trabajos nativos por ocurrencia lógica y actualiza SQLite de forma consistente.
   */
  private async cancelPatientScheduleInternal(
    patientId: string,
  ): Promise<{ success: boolean; pendingCount: number }> {
    let scheduled: readonly ScheduledNotificationItem[] = [];
    let listFailed = false;
    try {
      scheduled = await this.adapter.listScheduled();
    } catch {
      listFailed = true;
    }

    const timestamp = this.now();
    if (listFailed) {
      await this.database.run(
        `UPDATE notificacion_local
         SET estado = 'cancelacion_pendiente', actualizado_el = ?
         WHERE paciente_id = ? AND estado IN ('pendiente', 'programada')`,
        [timestamp, patientId],
      );
      return { success: false, pendingCount: 1 };
    }

    const patientJobs = scheduled.filter((s) => s.payload?.pacienteId === patientId);
    const jobsByNotifId = new Map<string, ScheduledNotificationItem[]>();
    const orphans: ScheduledNotificationItem[] = [];

    for (const item of patientJobs) {
      const notifId = item.payload?.notificacionId;
      if (notifId) {
        const list = jobsByNotifId.get(notifId) ?? [];
        list.push(item);
        jobsByNotifId.set(notifId, list);
      } else {
        orphans.push(item);
      }
    }

    let failedCount = 0;
    for (const orphan of orphans) {
      try {
        await this.adapter.cancel(orphan.nativeId);
      } catch {
        failedCount++;
      }
    }

    for (const [notifId, items] of jobsByNotifId.entries()) {
      const res = await this.cancelOccurrenceJobs(notifId, items);
      if (!res.success) {
        failedCount++;
      }
    }

    // Cerrar también en SQLite cualquier fila activa de este paciente que ya no existiese en el SO
    const notifIdsArray = Array.from(jobsByNotifId.keys());
    if (notifIdsArray.length > 0) {
      const placeholders = notifIdsArray.map(() => '?').join(',');
      await this.database.run(
        `UPDATE notificacion_local
         SET estado = 'cancelada', id_nativo = NULL, actualizado_el = ?
         WHERE paciente_id = ? AND estado IN ('pendiente', 'programada') AND id NOT IN (${placeholders})`,
        [timestamp, patientId, ...notifIdsArray],
      );
    } else {
      await this.database.run(
        `UPDATE notificacion_local
         SET estado = 'cancelada', id_nativo = NULL, actualizado_el = ?
         WHERE paciente_id = ? AND estado IN ('pendiente', 'programada')`,
        [timestamp, patientId],
      );
    }

    return { success: failedCount === 0, pendingCount: failedCount };
  }

  /**
   * Intenta cancelar todos los trabajos nativos de un paciente dado (ej. al cambiar de contexto A -> B).
   */
  async cancelPatientSchedule(
    patientId: string,
  ): Promise<{ success: boolean; pendingCount: number }> {
    return this.mutex.enqueue(() => this.cancelPatientScheduleInternal(patientId));
  }

  /**
   * Reconcilia la agenda de un paciente de manera determinista.
   */
  async reconcile(patientId: string, isContextActive?: () => boolean): Promise<CoordinatorResult> {
    return this.mutex.enqueue(async () => {
      const isStillActive = () => {
        if (isContextActive && !isContextActive()) return false;
        if (this.getActivePatientId) {
          const active = this.getActivePatientId();
          if (active !== patientId) return false;
        }
        return true;
      };

      const abortResult: CoordinatorResult = {
        status: 'desactivada',
        totalDeseadas: 0,
        programadasConfirmadas: 0,
        cubiertoHastaIso: null,
        truncadas: 0,
        reglasAfectadas: [],
        incidencias: ['Operación omitida por cambio de contexto activo.'],
      };

      if (!isStillActive()) return abortResult;

      try {
        // 1. Reintentar resolver cancelaciones pendientes conocidas en SQLite
        await this.retryPendingCancellations();
        if (!isStillActive()) return abortResult;

        // 2. Inspeccionar agenda nativa del SO mediante el contrato real listScheduled()
        const scheduledNativeJobs: readonly ScheduledNotificationItem[] =
          await this.adapter.listScheduled();
        if (!isStillActive()) return abortResult;

        const foreignNativeJobs = scheduledNativeJobs.filter(
          (job) => job.payload && job.payload.pacienteId !== patientId,
        );

        // 3. Consultar SQLite por filas pendientes o programadas de otros pacientes
        const foreignDbRows = await this.database.all<{ paciente_id: string }>(
          "SELECT DISTINCT paciente_id FROM notificacion_local WHERE estado IN ('cancelacion_pendiente', 'programada') AND paciente_id != ?",
          [patientId],
        );

        const foreignPatientIds = new Set<string>([
          ...foreignNativeJobs.map((j) => j.payload!.pacienteId),
          ...foreignDbRows.map((r) => r.paciente_id),
        ]);

        // 4. Si existen avisos ajenos en SO o SQLite, resolver su cancelación antes de programar
        if (foreignPatientIds.size > 0) {
          for (const foreignId of foreignPatientIds) {
            const cancelRes = await this.cancelPatientScheduleInternal(foreignId);
            if (!(cancelRes.success && cancelRes.pendingCount === 0)) {
              return {
                status: 'programacion_pendiente',
                motivoPendiente: 'contexto_anterior',
                totalDeseadas: 0,
                programadasConfirmadas: 0,
                cubiertoHastaIso: null,
                truncadas: 0,
                reglasAfectadas: [],
                incidencias: [
                  `La programación permanece pausada esperando resolver cancelaciones del contexto anterior (${foreignId}).`,
                ],
              };
            }
          }
        }
      } catch (err) {
        return {
          status: 'programacion_pendiente',
          motivoPendiente: 'contexto_anterior',
          totalDeseadas: 0,
          programadasConfirmadas: 0,
          cubiertoHastaIso: null,
          truncadas: 0,
          reglasAfectadas: [],
          incidencias: [
            `La programación permanece pausada por fallo al verificar o cancelar avisos del contexto anterior: ${err instanceof Error ? err.message : String(err)}.`,
          ],
        };
      }

      const repo = createReminderRepository(this.database, patientId, this.now, generateUuid);
      const prefs = await repo.getPreferences();

      if (!isStillActive()) return abortResult;

      // Si las preferencias del paciente están desactivadas
      if (!prefs.enabled) {
        const cancelRes = await this.cancelPatientScheduleInternal(patientId);
        if (!cancelRes.success) {
          return {
            status: 'programacion_pendiente',
            motivoPendiente: 'cancelacion_regla_previa',
            totalDeseadas: 0,
            programadasConfirmadas: 0,
            cubiertoHastaIso: null,
            truncadas: 0,
            reglasAfectadas: [],
            incidencias: [
              'No se pudieron cancelar todas las notificaciones en el sistema operativo.',
            ],
          };
        }

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

      // Consultar permiso nativo y estado del canal
      const permState = await this.adapter.getPermissionState();
      if (!isStillActive()) return abortResult;

      if (permState.status !== 'granted' || permState.channelStatus === 'blocked') {
        const cancelRes = await this.cancelPatientScheduleInternal(patientId);
        const incidencias = [
          permState.channelStatus === 'blocked'
            ? 'El canal de notificaciones está bloqueado en los ajustes del sistema.'
            : 'Permiso de notificaciones no concedido en el sistema operativo.',
        ];
        if (!cancelRes.success) {
          incidencias.push(
            'Fallo al cancelar notificaciones en el SO tras revocación o bloqueo de permisos.',
          );
        }

        return {
          status: 'permiso_denegado',
          totalDeseadas: 0,
          programadasConfirmadas: 0,
          cubiertoHastaIso: null,
          truncadas: 0,
          reglasAfectadas: [],
          incidencias,
          permission: permState,
        };
      }

      // 2. Transicionar ocurrencias pasadas no observadas a 'finalizada_sin_observacion'
      const nowIso = this.now();
      await this.database.run(
        `UPDATE notificacion_local
         SET estado = 'finalizada_sin_observacion', actualizado_el = ?
         WHERE paciente_id = ? AND fecha_prevista_utc <= ? AND estado IN ('pendiente', 'programada') AND recibida_observada_en IS NULL`,
        [nowIso, patientId, nowIso],
      );

      if (!isStillActive()) return abortResult;

      // 3. Calcular ocurrencias deseadas
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
        now: new Date(nowIso),
        idGenerator: generateUuid,
      });

      if (!isStillActive()) return abortResult;

      // 4. Obtener lista actual de trabajos nativos en el SO
      let allNative: readonly ScheduledNotificationItem[];
      try {
        allNative = await this.adapter.listScheduled();
      } catch (listErr) {
        return {
          status: 'error',
          totalDeseadas: plan.totalCalculadas,
          programadasConfirmadas: 0,
          cubiertoHastaIso: null,
          truncadas: plan.truncadas,
          reglasAfectadas: plan.reglasAfectadas,
          incidencias: [
            `No se pudo consultar la agenda del sistema operativo: ${(listErr as Error).message}`,
          ],
          permission: permState,
        };
      }

      if (!isStillActive()) return abortResult;

      const patientNative = allNative.filter((s) => s.payload?.pacienteId === patientId);

      // Mapa de candidatos deseados por clave lógica
      // clave: `${recordatorioId}:${revision}:${fechaPrevistaUtc}`
      const desiredMap = new Map<string, OccurrenceCandidate>();
      for (const cand of plan.seleccionadas) {
        desiredMap.set(`${cand.recordatorioId}:${cand.revision}:${cand.fechaPrevistaUtc}`, cand);
      }

      // 5. Cancelar obsoletos, evaluar adopción condicionada, desempate de duplicados y detección de reglas bloqueadas
      const rulesWithFailedCancellation = new Set<string>();
      const incidencias: string[] = [];

      // Chequear si ya existen cancelaciones pendientes para este paciente en SQLite
      const priorPendingCancels = await this.database.all<{ recordatorio_id: string }>(
        "SELECT DISTINCT recordatorio_id FROM notificacion_local WHERE paciente_id = ? AND estado = 'cancelacion_pendiente'",
        [patientId],
      );
      for (const row of priorPendingCancels) {
        if (row.recordatorio_id) {
          rulesWithFailedCancellation.add(row.recordatorio_id);
        }
      }

      const nativeByNotifId = new Map<string, typeof patientNative>();
      for (const item of patientNative) {
        const notifId = item.payload?.notificacionId;
        if (!notifId) {
          try {
            await this.adapter.cancel(item.nativeId);
          } catch (err) {
            if (item.payload?.recordatorioId) {
              rulesWithFailedCancellation.add(item.payload.recordatorioId);
            }
            incidencias.push(
              `Fallo al cancelar trabajo nativo huérfano ${item.nativeId}: ${(err as Error).message}`,
            );
          }
          continue;
        }
        const group = nativeByNotifId.get(notifId) ?? [];
        group.push(item);
        nativeByNotifId.set(notifId, group);
      }

      const adoptedNativeIds = new Set<string>();

      for (const [notifId, group] of nativeByNotifId.entries()) {
        if (!isStillActive()) return abortResult;

        const dbJob = await this.database.first<NotificationRecord>(
          'SELECT * FROM notificacion_local WHERE paciente_id = ? AND id = ?',
          [patientId, notifId],
        );

        let chosen = group[0];
        if (group.length > 1) {
          const matchingDb = group.find((g) => g.nativeId === dbJob?.id_nativo);
          if (matchingDb) {
            chosen = matchingDb;
          } else {
            chosen = [...group].sort((a, b) => a.nativeId.localeCompare(b.nativeId))[0];
          }
        }

        const duplicates = group.filter((g) => g.nativeId !== chosen.nativeId);
        const candidateKey = `${chosen.payload?.recordatorioId}:${chosen.payload?.revision}:${chosen.triggerDateUtc}`;
        const isInDesiredSet = desiredMap.has(candidateKey);
        const isNotPendingCancel = dbJob?.estado !== 'cancelacion_pendiente';

        if (dbJob && isInDesiredSet && isNotPendingCancel) {
          let duplicateCancelFailed = false;
          let lastDupError: Error | undefined;
          for (const dup of duplicates) {
            try {
              await this.adapter.cancel(dup.nativeId);
            } catch (err) {
              duplicateCancelFailed = true;
              lastDupError = err as Error;
            }
          }

          if (duplicateCancelFailed) {
            const ruleId = chosen.payload?.recordatorioId || dbJob?.recordatorio_id;
            if (ruleId) rulesWithFailedCancellation.add(ruleId);
            await this.database.run(
              `UPDATE notificacion_local
               SET estado = 'cancelacion_pendiente', error = ?, actualizado_el = ?
               WHERE id = ?`,
              [
                lastDupError?.message ?? 'Fallo al cancelar trabajo duplicado en el SO',
                this.now(),
                notifId,
              ],
            );
            incidencias.push(
              `Fallo al cancelar trabajo duplicado en el SO (regla: ${ruleId ?? 'desconocida'}): ${lastDupError?.message}`,
            );
          } else {
            await this.database.run(
              "UPDATE notificacion_local SET id_nativo = ?, estado = 'programada', error = NULL, actualizado_el = ? WHERE id = ?",
              [chosen.nativeId, this.now(), notifId],
            );
            adoptedNativeIds.add(chosen.nativeId);
            const candidate = desiredMap.get(candidateKey);
            if (candidate) {
              candidate.id = notifId;
            }
          }
        } else {
          // No es deseada o está en cancelacion_pendiente: se deben cancelar TODOS los trabajos nativos
          const res = await this.cancelOccurrenceJobs(notifId, group);
          if (!res.success) {
            const ruleId = chosen.payload?.recordatorioId || dbJob?.recordatorio_id;
            if (ruleId) rulesWithFailedCancellation.add(ruleId);
            incidencias.push(
              `No se pudo cancelar el aviso obsoleto en el SO (regla: ${ruleId ?? 'desconocida'}): ${res.error?.message}`,
            );
          }
        }
      }

      // Cancelar en SQLite cualquier trabajo activo que ya no esté en desiredMap ni en nativeByNotifId
      const nonDesiredDbJobs = await this.database.all<NotificationRecord>(
        "SELECT * FROM notificacion_local WHERE paciente_id = ? AND estado IN ('pendiente', 'programada')",
        [patientId],
      );
      for (const job of nonDesiredDbJobs) {
        if (nativeByNotifId.has(job.id)) continue;
        const key = `${job.recordatorio_id}:${job.revision}:${job.fecha_prevista_utc}`;
        if (!desiredMap.has(key)) {
          const matchingNative = patientNative.filter(
            (n) => n.nativeId === job.id_nativo || n.payload?.notificacionId === job.id,
          );
          const res = await this.cancelOccurrenceJobs(job.id, matchingNative);
          if (!res.success) {
            rulesWithFailedCancellation.add(job.recordatorio_id);
            incidencias.push(
              `No se pudo cancelar trabajo en SO para regla ${job.recordatorio_id}: ${res.error?.message}`,
            );
          }
        }
      }

      // 6. Programar las ocurrencias restantes que no tengan trabajo nativo adoptado
      let confirmadas = 0;
      const confirmedDates: string[] = [];
      let hasPostponedRules = false;

      for (const cand of plan.seleccionadas) {
        if (!isStillActive()) return abortResult;

        // Si la regla tiene cancelaciones pendientes o fallidas, posponer su programación sustitutiva
        if (rulesWithFailedCancellation.has(cand.recordatorioId)) {
          hasPostponedRules = true;
          continue;
        }

        const existing = await this.database.first<NotificationRecord>(
          'SELECT * FROM notificacion_local WHERE paciente_id = ? AND recordatorio_id = ? AND revision = ? AND fecha_prevista_utc = ?',
          [patientId, cand.recordatorioId, cand.revision, cand.fechaPrevistaUtc],
        );

        // Verificación estricta: debe existir y su id_nativo debe haber sido adoptado efectivamente del SO
        if (
          existing?.estado === 'programada' &&
          existing.id_nativo &&
          adoptedNativeIds.has(existing.id_nativo)
        ) {
          confirmadas++;
          confirmedDates.push(cand.fechaPrevistaUtc);
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

        if (!isStillActive()) return abortResult;

        // Paso B: Programar en el SO
        let nativeId: string;
        try {
          const res = await this.adapter.schedule({
            triggerDateUtc: cand.fechaPrevistaUtc,
            ...reminderNotificationCopy(cand.tipo === 'registro_vitales' ? 'signos' : 'medicacion'),
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

        if (!isStillActive()) {
          try {
            await this.adapter.cancel(nativeId);
          } catch {
            // Ignorar fallo de cancelación de compensación al abortar por cambio de contexto
          }
          return abortResult;
        }

        // Paso C: Persistir id_nativo en SQLite (con compensación inmediata si falla)
        try {
          await repo.markNotificationScheduled(stableNotifId, nativeId);
          confirmadas++;
          confirmedDates.push(cand.fechaPrevistaUtc);
        } catch {
          try {
            await this.adapter.cancel(nativeId);
            incidencias.push('Fallo de persistencia en SQLite; trabajo nativo compensado.');
          } catch (cancelErr) {
            incidencias.push(
              `Fallo de persistencia en SQLite y fallo al compensar trabajo nativo: ${(cancelErr as Error).message}`,
            );
          }
        }
      }

      if (hasPostponedRules) {
        for (const ruleId of rulesWithFailedCancellation) {
          incidencias.push(
            `Programación de nuevos avisos para la regla ${ruleId} pospuesta hasta resolver la cancelación de su versión anterior.`,
          );
        }
      }

      // Calcular cobertura desde los trabajos CONFIRMADOS
      let maxConfirmedUtc: string | null = null;
      if (confirmedDates.length > 0) {
        confirmedDates.sort();
        maxConfirmedUtc = confirmedDates[confirmedDates.length - 1];
      }

      let status: CoordinatorResult['status'] = 'programada';
      let motivoPendiente: CoordinatorResult['motivoPendiente'] = undefined;
      let cubiertoHasta = maxConfirmedUtc;

      if (hasPostponedRules || rulesWithFailedCancellation.size > 0) {
        status = 'programacion_pendiente';
        motivoPendiente = 'cancelacion_regla_previa';
      } else if (plan.seleccionadas.length > 0) {
        if (confirmadas === 0) {
          status = 'error';
          cubiertoHasta = null;
        } else if (confirmadas < plan.seleccionadas.length) {
          status = 'programacion_pendiente';
          motivoPendiente = 'programacion_parcial';
        }
      } else {
        cubiertoHasta = null;
      }

      return {
        status,
        motivoPendiente,
        totalDeseadas: plan.totalCalculadas,
        programadasConfirmadas: confirmadas,
        cubiertoHastaIso: cubiertoHasta,
        truncadas: plan.truncadas,
        reglasAfectadas: plan.reglasAfectadas,
        incidencias,
        permission: permState,
      };
    });
  }
}
