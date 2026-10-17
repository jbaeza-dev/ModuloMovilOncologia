import type { SqlConnection } from '../core/sql';
import {
  generateUuid,
  type NoticePreferencesRecord,
  type NotificationItem,
  type NotificationJobPayload,
  type NotificationJobState,
  type NotificationRecord,
  type ReminderActivationIntent,
  type ReminderRule,
  type ReminderRuleRecord,
  type ReminderStatusSnapshot,
  type ReminderType,
  type SaveReminderInput,
  type SaveRuleWithActivationResult,
} from './reminder-types';

export type Clock = () => string;
export type IdGenerator = () => string;

export function createReminderRepository(
  database: SqlConnection,
  patientId: string,
  now: Clock = () => new Date().toISOString(),
  newId: IdGenerator = generateUuid,
) {
  function mapRule(record: ReminderRuleRecord): ReminderRule {
    let diasSemana: number[];
    try {
      diasSemana = JSON.parse(record.dias_semana);
    } catch {
      diasSemana = [];
    }

    let horasMinutos: string[];
    try {
      horasMinutos = JSON.parse(record.horas_minutos);
    } catch {
      horasMinutos = [];
    }

    return {
      id: record.id,
      pacienteId: record.paciente_id,
      tipo: record.tipo,
      medicamentoId: record.medicamento_id,
      diasSemana,
      horasMinutos,
      zonaHoraria: record.zona_horaria,
      fechaInicio: record.fecha_inicio,
      fechaFin: record.fecha_fin,
      habilitado: record.habilitado === 1,
      revision: record.revision,
      eliminadoEl: record.eliminado_el,
      creadoEl: record.creado_el,
      actualizadoEl: record.actualizado_el,
    };
  }

  function mapNotification(record: NotificationRecord): NotificationItem {
    let payload: NotificationJobPayload;
    try {
      payload = JSON.parse(record.payload_minimo);
    } catch {
      payload = {
        version: 1,
        notificacionId: record.id,
        revision: record.revision,
        pacienteId: record.paciente_id,
        recordatorioId: record.recordatorio_id,
        tipo: record.tipo,
        destino: record.tipo === 'registro_vitales' ? '/vitales/registrar' : '/perfil/medicacion',
      };
    }

    return {
      id: record.id,
      pacienteId: record.paciente_id,
      recordatorioId: record.recordatorio_id,
      revision: record.revision,
      tipo: record.tipo,
      fechaPrevistaUtc: record.fecha_prevista_utc,
      idNativo: record.id_nativo,
      estado: record.estado,
      payloadMinimo: payload,
      error: record.error,
      recibidaObservadaEn: record.recibida_observada_en,
      abiertaEn: record.abierta_en,
      creadoEl: record.creado_el,
      actualizadoEl: record.actualizado_el,
    };
  }

  function validateInput(input: SaveReminderInput) {
    if (!input.diasSemana || input.diasSemana.length === 0) {
      throw new Error('Debes seleccionar al menos un día de la semana.');
    }
    for (const dia of input.diasSemana) {
      if (!Number.isInteger(dia) || dia < 1 || dia > 7) {
        throw new Error(`Día de la semana inválido: ${dia}. Debe estar entre 1 y 7.`);
      }
    }
    if (new Set(input.diasSemana).size !== input.diasSemana.length) {
      throw new Error('No se permiten días duplicados.');
    }

    if (!input.horasMinutos || input.horasMinutos.length === 0) {
      throw new Error('Debes configurar al menos una hora.');
    }
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    for (const hora of input.horasMinutos) {
      if (!timeRegex.test(hora)) {
        throw new Error(`Hora inválida: ${hora}. Debe tener formato HH:mm (00:00 - 23:59).`);
      }
    }
    if (new Set(input.horasMinutos).size !== input.horasMinutos.length) {
      throw new Error('No se permiten horas duplicadas.');
    }

    if (input.tipo === 'medicacion' && !input.medicamentoId) {
      throw new Error('Un recordatorio de medicación exige vincular un medicamento del paciente.');
    }
    if (input.tipo === 'registro_vitales' && input.medicamentoId) {
      throw new Error('Un recordatorio de signos vitales no debe vincular un medicamento.');
    }

    if (input.fechaInicio && input.fechaFin && input.fechaInicio > input.fechaFin) {
      throw new Error('La fecha de inicio no puede ser posterior a la fecha de término.');
    }
  }

  async function getPreferencesFromConn(
    conn: SqlConnection,
  ): Promise<{ enabled: boolean; updatedAt: string | null }> {
    const row = await conn.first<NoticePreferencesRecord>(
      'SELECT * FROM preferencia_avisos WHERE paciente_id = ?',
      [patientId],
    );
    return {
      enabled: row?.habilitado === 1,
      updatedAt: row?.actualizado_el ?? null,
    };
  }

  async function setPreferencesInConn(
    conn: SqlConnection,
    enabled: boolean,
    timestamp: string,
  ): Promise<void> {
    await conn.run(
      `INSERT INTO preferencia_avisos (paciente_id, habilitado, actualizado_el)
       VALUES (?, ?, ?)
       ON CONFLICT(paciente_id) DO UPDATE SET
         habilitado = excluded.habilitado,
         actualizado_el = excluded.actualizado_el`,
      [patientId, enabled ? 1 : 0, timestamp],
    );
  }

  async function saveRuleInConn(
    conn: SqlConnection,
    input: SaveReminderInput,
    timestamp: string,
  ): Promise<ReminderRule> {
    const diasSorted = [...input.diasSemana].sort((a, b) => a - b);
    const horasSorted = [...input.horasMinutos].sort();
    const diasJson = JSON.stringify(diasSorted);
    const horasJson = JSON.stringify(horasSorted);
    const tz =
      input.zonaHoraria || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santiago';
    const habilitadoVal = input.habilitado ? 1 : 0;

    if (input.id) {
      const existing = await conn.first<ReminderRuleRecord>(
        'SELECT * FROM recordatorio_local WHERE paciente_id = ? AND id = ?',
        [patientId, input.id],
      );
      if (!existing) {
        throw new Error(`No se encontró el recordatorio con ID ${input.id}`);
      }
      const nextRevision = existing.revision + 1;
      await conn.run(
        `UPDATE recordatorio_local
         SET tipo = ?, medicamento_id = ?, dias_semana = ?, horas_minutos = ?, zona_horaria = ?,
             fecha_inicio = ?, fecha_fin = ?, habilitado = ?, revision = ?, eliminado_el = NULL, actualizado_el = ?
         WHERE paciente_id = ? AND id = ?`,
        [
          input.tipo,
          input.medicamentoId ?? null,
          diasJson,
          horasJson,
          tz,
          input.fechaInicio ?? null,
          input.fechaFin ?? null,
          habilitadoVal,
          nextRevision,
          timestamp,
          patientId,
          input.id,
        ],
      );
      return {
        id: input.id,
        pacienteId: patientId,
        tipo: input.tipo,
        medicamentoId: input.medicamentoId ?? null,
        diasSemana: diasSorted,
        horasMinutos: horasSorted,
        zonaHoraria: tz,
        fechaInicio: input.fechaInicio ?? null,
        fechaFin: input.fechaFin ?? null,
        habilitado: input.habilitado ?? false,
        revision: nextRevision,
        eliminadoEl: null,
        creadoEl: existing.creado_el,
        actualizadoEl: timestamp,
      };
    }

    const id = newId();
    await conn.run(
      `INSERT INTO recordatorio_local (
         id, paciente_id, tipo, medicamento_id, dias_semana, horas_minutos, zona_horaria,
         fecha_inicio, fecha_fin, habilitado, revision, eliminado_el, creado_el, actualizado_el
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
      [
        id,
        patientId,
        input.tipo,
        input.medicamentoId ?? null,
        diasJson,
        horasJson,
        tz,
        input.fechaInicio ?? null,
        input.fechaFin ?? null,
        habilitadoVal,
        timestamp,
        timestamp,
      ],
    );
    return {
      id,
      pacienteId: patientId,
      tipo: input.tipo,
      medicamentoId: input.medicamentoId ?? null,
      diasSemana: diasSorted,
      horasMinutos: horasSorted,
      zonaHoraria: tz,
      fechaInicio: input.fechaInicio ?? null,
      fechaFin: input.fechaFin ?? null,
      habilitado: input.habilitado ?? false,
      revision: 1,
      eliminadoEl: null,
      creadoEl: timestamp,
      actualizadoEl: timestamp,
    };
  }

  return {
    async getPreferences(): Promise<{ enabled: boolean; updatedAt: string | null }> {
      return getPreferencesFromConn(database);
    },

    async setPreferences(enabled: boolean): Promise<void> {
      const timestamp = now();
      await setPreferencesInConn(database, enabled, timestamp);
    },

    async getReminderStatusSnapshot(nowIso?: string): Promise<ReminderStatusSnapshot> {
      const effectiveNowIso = nowIso ?? now();
      let snapshot: ReminderStatusSnapshot | null = null;

      await database.transaction(async (tx) => {
        const preferences = await getPreferencesFromConn(tx);
        const ruleRows = await tx.all<ReminderRuleRecord>(
          'SELECT * FROM recordatorio_local WHERE paciente_id = ? AND eliminado_el IS NULL ORDER BY creado_el ASC, id ASC',
          [patientId],
        );
        const notifRows = await tx.all<NotificationRecord>(
          'SELECT * FROM notificacion_local WHERE paciente_id = ? AND fecha_prevista_utc > ? ORDER BY fecha_prevista_utc ASC, id ASC',
          [patientId, effectiveNowIso],
        );
        const medRows = await tx.all<{
          id: string;
          nombre: string;
          fecha_inicio: string | null;
          fecha_fin: string | null;
          estado_activo: number;
        }>(
          'SELECT id, nombre, fecha_inicio, fecha_fin, estado_activo FROM medicamento_activo_cache WHERE paciente_id = ? ORDER BY id ASC',
          [patientId],
        );

        const rules = ruleRows.map(mapRule);
        const futureNotifications = notifRows.map(mapNotification);
        const medications = medRows.map((m) => ({
          id: m.id,
          nombre: m.nombre,
          fechaInicio: m.fecha_inicio,
          fechaFin: m.fecha_fin,
          estadoActivo: m.estado_activo === 1,
        }));
        const allEnabledRulesCount = rules.filter((r) => r.habilitado).length;

        snapshot = {
          patientId,
          nowIso: effectiveNowIso,
          preferences,
          rules,
          futureNotifications,
          medications,
          allEnabledRulesCount,
        };
      });

      if (!snapshot) {
        throw new Error('No se pudo obtener la instantánea de recordatorios.');
      }
      return snapshot;
    },

    async listRules(includeDeleted = false): Promise<ReminderRule[]> {
      const sql = includeDeleted
        ? 'SELECT * FROM recordatorio_local WHERE paciente_id = ? ORDER BY creado_el ASC, id ASC'
        : 'SELECT * FROM recordatorio_local WHERE paciente_id = ? AND eliminado_el IS NULL ORDER BY creado_el ASC, id ASC';
      const rows = await database.all<ReminderRuleRecord>(sql, [patientId]);
      return rows.map(mapRule);
    },

    async getRule(id: string): Promise<ReminderRule | null> {
      const row = await database.first<ReminderRuleRecord>(
        'SELECT * FROM recordatorio_local WHERE paciente_id = ? AND id = ?',
        [patientId, id],
      );
      return row ? mapRule(row) : null;
    },

    async saveRuleWithActivationIntent(
      input: SaveReminderInput,
      intent: ReminderActivationIntent = 'keep_existing',
    ): Promise<SaveRuleWithActivationResult> {
      validateInput(input);
      const effectiveHabilitado =
        intent === 'save_and_activate' || intent === 'save_and_resume_all'
          ? true
          : intent === 'save_disabled'
            ? false
            : (input.habilitado ?? false);

      let result: SaveRuleWithActivationResult | null = null;

      await database.transaction(async (tx) => {
        const timestamp = now();
        const currentPrefs = await getPreferencesFromConn(tx);
        const otherEnabledRow = input.id
          ? await tx.first<{ total: number }>(
              'SELECT count(*) AS total FROM recordatorio_local WHERE paciente_id = ? AND eliminado_el IS NULL AND habilitado = 1 AND id != ?',
              [patientId, input.id],
            )
          : await tx.first<{ total: number }>(
              'SELECT count(*) AS total FROM recordatorio_local WHERE paciente_id = ? AND eliminado_el IS NULL AND habilitado = 1',
              [patientId],
            );
        const otherEnabledRulesCount = otherEnabledRow?.total ?? 0;

        const savedRule = await saveRuleInConn(
          tx,
          { ...input, habilitado: effectiveHabilitado },
          timestamp,
        );

        let preferencesEnabled = currentPrefs.enabled;
        let resumedGeneralPreference = false;
        let pausedByGeneralPreference = false;

        if (intent === 'save_and_activate') {
          if (currentPrefs.enabled) {
            preferencesEnabled = true;
          } else if (otherEnabledRulesCount === 0) {
            await setPreferencesInConn(tx, true, timestamp);
            preferencesEnabled = true;
            resumedGeneralPreference = true;
          } else {
            preferencesEnabled = false;
            pausedByGeneralPreference = true;
          }
        } else if (intent === 'save_and_resume_all') {
          await setPreferencesInConn(tx, true, timestamp);
          preferencesEnabled = true;
          resumedGeneralPreference = !currentPrefs.enabled;
        } else {
          pausedByGeneralPreference = Boolean(savedRule.habilitado && !currentPrefs.enabled);
        }

        result = {
          rule: savedRule,
          preferencesEnabled,
          resumedGeneralPreference,
          pausedByGeneralPreference,
          otherEnabledRulesCount,
        };
      });

      if (!result) {
        throw new Error('No se pudo guardar el recordatorio.');
      }
      return result;
    },

    async saveRule(input: SaveReminderInput): Promise<ReminderRule> {
      const res = await this.saveRuleWithActivationIntent(input, 'keep_existing');
      return res.rule;
    },

    async deleteRule(id: string): Promise<void> {
      const timestamp = now();
      await database.transaction(async (tx) => {
        const existing = await tx.first<ReminderRuleRecord>(
          'SELECT * FROM recordatorio_local WHERE paciente_id = ? AND id = ?',
          [patientId, id],
        );
        if (!existing || existing.eliminado_el) return;

        const nextRevision = existing.revision + 1;
        await tx.run(
          `UPDATE recordatorio_local
           SET eliminado_el = ?, habilitado = 0, revision = ?, actualizado_el = ?
           WHERE paciente_id = ? AND id = ?`,
          [timestamp, nextRevision, timestamp, patientId, id],
        );

        // Marcar trabajos futuros no observados como cancelacion_pendiente
        await tx.run(
          `UPDATE notificacion_local
           SET estado = 'cancelacion_pendiente', actualizado_el = ?
           WHERE paciente_id = ? AND recordatorio_id = ? AND estado IN ('pendiente', 'programada')`,
          [timestamp, patientId, id],
        );
      });
    },

    async listNotifications(options?: {
      limit?: number;
      offset?: number;
      estado?: NotificationJobState;
      soloObservadas?: boolean;
      orderBy?: 'fecha_prevista' | 'actividad_reciente';
    }): Promise<NotificationItem[]> {
      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;
      let sql = 'SELECT * FROM notificacion_local WHERE paciente_id = ?';
      const params: (string | number)[] = [patientId];

      if (options?.estado) {
        sql += ' AND estado = ?';
        params.push(options.estado);
      }
      if (options?.soloObservadas) {
        sql += ' AND (recibida_observada_en IS NOT NULL OR abierta_en IS NOT NULL)';
      }

      if (options?.orderBy === 'actividad_reciente') {
        sql += ` ORDER BY
          CASE
            WHEN abierta_en IS NOT NULL AND recibida_observada_en IS NOT NULL
              THEN (CASE WHEN abierta_en > recibida_observada_en THEN abierta_en ELSE recibida_observada_en END)
            WHEN abierta_en IS NOT NULL THEN abierta_en
            ELSE recibida_observada_en
          END DESC,
          id DESC
          LIMIT ? OFFSET ?`;
      } else {
        sql += ' ORDER BY fecha_prevista_utc DESC, id DESC LIMIT ? OFFSET ?';
      }
      params.push(limit, offset);

      const rows = await database.all<NotificationRecord>(sql, params);
      return rows.map(mapNotification);
    },

    async getNotification(id: string): Promise<NotificationItem | null> {
      const row = await database.first<NotificationRecord>(
        'SELECT * FROM notificacion_local WHERE paciente_id = ? AND id = ?',
        [patientId, id],
      );
      return row ? mapNotification(row) : null;
    },

    async reserveOccurrence(job: {
      id: string;
      recordatorioId: string;
      revision: number;
      tipo: ReminderType;
      fechaPrevistaUtc: string;
      payload: NotificationJobPayload;
    }): Promise<void> {
      const timestamp = now();
      await database.run(
        `INSERT INTO notificacion_local (
           id, paciente_id, recordatorio_id, revision, tipo, fecha_prevista_utc,
           id_nativo, estado, payload_minimo, error, recibida_observada_en, abierta_en, creado_el, actualizado_el
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'pendiente', ?, NULL, NULL, NULL, ?, ?)
         ON CONFLICT(paciente_id, recordatorio_id, revision, fecha_prevista_utc) DO UPDATE SET
           payload_minimo = excluded.payload_minimo,
           actualizado_el = excluded.actualizado_el`,
        [
          job.id,
          patientId,
          job.recordatorioId,
          job.revision,
          job.tipo,
          job.fechaPrevistaUtc,
          JSON.stringify(job.payload),
          timestamp,
          timestamp,
        ],
      );
    },

    async markNotificationScheduled(id: string, nativeId: string): Promise<void> {
      const timestamp = now();
      await database.run(
        `UPDATE notificacion_local
         SET id_nativo = ?, estado = 'programada', error = NULL, actualizado_el = ?
         WHERE paciente_id = ? AND id = ?`,
        [nativeId, timestamp, patientId, id],
      );
    },

    async markNotificationError(id: string, errorMessage: string): Promise<void> {
      const timestamp = now();
      await database.run(
        `UPDATE notificacion_local
         SET estado = 'error', error = ?, actualizado_el = ?
         WHERE paciente_id = ? AND id = ?`,
        [errorMessage, timestamp, patientId, id],
      );
    },

    async markNotificationCancelled(id: string): Promise<void> {
      const timestamp = now();
      await database.run(
        `UPDATE notificacion_local
         SET estado = 'cancelada', actualizado_el = ?
         WHERE paciente_id = ? AND id = ?`,
        [timestamp, patientId, id],
      );
    },

    async markNotificationCancellationPending(id: string): Promise<void> {
      const timestamp = now();
      await database.run(
        `UPDATE notificacion_local
         SET estado = 'cancelacion_pendiente', actualizado_el = ?
         WHERE paciente_id = ? AND id = ?`,
        [timestamp, patientId, id],
      );
    },

    async recordNotificationObserved(id: string, observedAt?: string): Promise<void> {
      const timestamp = observedAt ?? now();
      await database.run(
        `UPDATE notificacion_local
         SET recibida_observada_en = COALESCE(recibida_observada_en, ?), actualizado_el = ?
         WHERE paciente_id = ? AND id = ?`,
        [timestamp, timestamp, patientId, id],
      );
    },

    async recordNotificationOpened(id: string, openedAt?: string): Promise<void> {
      const timestamp = openedAt ?? now();
      await database.run(
        `UPDATE notificacion_local
         SET abierta_en = COALESCE(abierta_en, ?), actualizado_el = ?
         WHERE paciente_id = ? AND id = ?`,
        [timestamp, timestamp, patientId, id],
      );
    },
  };
}

export type ReminderRepository = ReturnType<typeof createReminderRepository>;
