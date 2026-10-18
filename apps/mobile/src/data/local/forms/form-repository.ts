import type { SqlConnection } from '../core/sql';
import {
  type DailyDraftData,
  type DailyFormStatus,
  type FormAnswerValue,
  type FormDefinitionRecord,
  type FormDraftRecord,
  type FormQuestionRecord,
  type FormSubmissionRecord,
  ConflictoEntregaError,
} from './form-types';
import {
  areAnswersEqual,
  normalizeFormQuestionsRecords,
  validateFormQuestionsRecords,
} from './form-validation';
import {
  createDailyFormContext,
  formatDailyPeriodKey,
  getCivilDateInTimeZone,
  DEFAULT_FORMS_TIMEZONE,
  type DailyFormContext,
} from '../../../services/forms/daily-form-context';

export type IdFactory = () => string;
export type Clock = () => string;

export type AssignedFormSummary = {
  formulario_id: string;
  version: string;
  titulo: string;
  descripcion: string;
  duracion_estimada_min: number;
  estado_conocido: 'activa' | 'retirada';
  borrador_entrega_id: string | null;
  borrador_guardado_en: string | null;
  borrador_respuestas: Record<string, FormAnswerValue> | null;
  borrador_periodo_clave: string | null;
  borrador_fecha_seguimiento: string | null;
  borrador_paso_actual: string | null;
  ultima_entrega_id: string | null;
  ultima_fecha_confirmacion: string | null;
};

export type { DailyFormStatus };

export type FullFormDefinition = FormDefinitionRecord & {
  configuracion?: {
    secciones?: Array<{ id: string; titulo: string; orden: number; descripcion?: string }>;
    periodicidad?: 'daily' | 'standalone';
    schemaVersion?: number;
    [key: string]: unknown;
  };
  preguntas: Array<
    FormQuestionRecord & {
      configuracion?: {
        opciones?: Array<{ valor: string; etiqueta: string; esExcluyente?: boolean }>;
        minEtiqueta?: string;
        maxEtiqueta?: string;
        [key: string]: unknown;
      };
    }
  >;
};

export type FormSubmissionDetail = FormSubmissionRecord & {
  titulo: string;
  descripcion: string;
  estado_envio: string | null;
  respuestas: Record<string, FormAnswerValue>;
};

export function normalizeAnswers(
  answers: Record<string, FormAnswerValue>,
): Record<string, FormAnswerValue> {
  const sortedKeys = Object.keys(answers).sort();
  const normalized: Record<string, FormAnswerValue> = {};
  for (const key of sortedKeys) {
    const val = answers[key];
    if (Array.isArray(val)) {
      normalized[key] = [...val].sort();
    } else {
      normalized[key] = val;
    }
  }
  return normalized;
}

export function createFormRepository(
  database: SqlConnection,
  patientId: string,
  newId: IdFactory,
  now: Clock = () => new Date().toISOString(),
) {
  if (!patientId) throw new Error('Selecciona un paciente de prueba.');

  return {
    async listAssignedForms(periodoClave?: string): Promise<AssignedFormSummary[]> {
      const activePeriod =
        periodoClave ?? formatDailyPeriodKey(getCivilDateInTimeZone(now(), DEFAULT_FORMS_TIMEZONE));

      const rows = await database.all<{
        formulario_id: string;
        version: string;
        titulo: string;
        descripcion: string;
        duracion_estimada_min: number;
        estado_conocido: 'activa' | 'retirada';
        borrador_entrega_id: string | null;
        borrador_guardado_en: string | null;
        borrador_respuestas_json: string | null;
        borrador_periodo_clave: string | null;
        borrador_fecha_seguimiento: string | null;
        borrador_paso_actual: string | null;
        ultima_entrega_id: string | null;
        ultima_fecha_confirmacion: string | null;
      }>(
        `SELECT
           a.formulario_id,
           a.version,
           a.estado_conocido,
           f.titulo,
           f.descripcion,
           f.duracion_estimada_min,
           b.entrega_id AS borrador_entrega_id,
           b.guardado_en AS borrador_guardado_en,
           b.respuestas_json AS borrador_respuestas_json,
           b.periodo_clave AS borrador_periodo_clave,
           b.fecha_seguimiento AS borrador_fecha_seguimiento,
           b.paso_actual AS borrador_paso_actual,
           r.id AS ultima_entrega_id,
           r.fecha_confirmacion AS ultima_fecha_confirmacion
         FROM formulario_asignacion_cache a
         JOIN formulario_cache f
           ON f.formulario_id = a.formulario_id AND f.version = a.version
         LEFT JOIN (
           SELECT paciente_id, formulario_id, version, entrega_id, guardado_en, respuestas_json,
                  periodo_clave, fecha_seguimiento, paso_actual
           FROM (
             SELECT
               paciente_id, formulario_id, version, entrega_id, guardado_en, respuestas_json,
               periodo_clave, fecha_seguimiento, paso_actual,
               ROW_NUMBER() OVER (
                 PARTITION BY paciente_id, formulario_id, version
                 ORDER BY
                   CASE WHEN periodo_clave = ? THEN 0
                        WHEN periodo_clave LIKE 'dia:%' THEN 1
                        ELSE 2 END,
                   guardado_en DESC
               ) as rn
             FROM borrador_formulario
           )
           WHERE rn = 1
         ) b ON b.paciente_id = a.paciente_id AND b.formulario_id = a.formulario_id AND b.version = a.version
         LEFT JOIN (
           SELECT id, paciente_id, formulario_id, version, fecha_confirmacion
           FROM (
             SELECT
               id, paciente_id, formulario_id, version, fecha_confirmacion,
               ROW_NUMBER() OVER (
                 PARTITION BY paciente_id, formulario_id, version
                 ORDER BY fecha_confirmacion DESC, id DESC
               ) as rn
             FROM respuesta_formulario
           )
           WHERE rn = 1
         ) r ON r.paciente_id = a.paciente_id AND r.formulario_id = a.formulario_id AND r.version = a.version
         WHERE a.paciente_id = ? AND a.estado_conocido = 'activa'
         ORDER BY f.titulo ASC`,
        [activePeriod, patientId],
      );

      return rows.map((r) => {
        let respuestas: Record<string, FormAnswerValue> | null = null;
        if (r.borrador_respuestas_json) {
          try {
            respuestas = JSON.parse(r.borrador_respuestas_json);
          } catch {
            respuestas = null;
          }
        }
        return {
          formulario_id: r.formulario_id,
          version: r.version,
          titulo: r.titulo,
          descripcion: r.descripcion,
          duracion_estimada_min: r.duracion_estimada_min,
          estado_conocido: r.estado_conocido,
          borrador_entrega_id: r.borrador_entrega_id,
          borrador_guardado_en: r.borrador_guardado_en,
          borrador_respuestas: respuestas,
          borrador_periodo_clave: r.borrador_periodo_clave,
          borrador_fecha_seguimiento: r.borrador_fecha_seguimiento,
          borrador_paso_actual: r.borrador_paso_actual,
          ultima_entrega_id: r.ultima_entrega_id,
          ultima_fecha_confirmacion: r.ultima_fecha_confirmacion,
        };
      });
    },

    async getFormDefinition(formId: string, version?: string): Promise<FullFormDefinition | null> {
      const def = await database.first<FormDefinitionRecord>(
        `SELECT * FROM formulario_cache
         WHERE formulario_id = ? AND (? IS NULL OR version = ?)
         ORDER BY version DESC LIMIT 1`,
        [formId, version ?? null, version ?? null],
      );
      if (!def) return null;

      const questions = await database.all<FormQuestionRecord>(
        `SELECT * FROM pregunta_cache
         WHERE formulario_id = ? AND version = ?
         ORDER BY orden ASC`,
        [def.formulario_id, def.version],
      );

      let formConfig: Record<string, unknown> | undefined;
      if (def.configuracion_json) {
        try {
          formConfig = JSON.parse(def.configuracion_json);
        } catch {
          formConfig = undefined;
        }
      }

      return {
        ...def,
        configuracion: formConfig as FullFormDefinition['configuracion'],
        preguntas: questions.map((q) => {
          let configuracion: Record<string, unknown> | undefined;
          if (q.configuracion_json) {
            try {
              configuracion = JSON.parse(q.configuracion_json);
            } catch {
              configuracion = undefined;
            }
          }
          return {
            ...q,
            configuracion,
          };
        }),
      };
    },

    async saveDraft(
      formId: string,
      version: string,
      answers: Record<string, FormAnswerValue>,
      deliveryId: string,
      periodoClave = 'legacy',
    ): Promise<void> {
      if (!deliveryId) throw new Error('El deliveryId es requerido para guardar un borrador.');

      const assignment = await database.first<{ estado_conocido: string }>(
        `SELECT estado_conocido FROM formulario_asignacion_cache
         WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
        [patientId, formId, version],
      );
      if (!assignment || assignment.estado_conocido !== 'activa') {
        throw new Error('No existe una asignación activa para este cuestionario.');
      }

      const questions = await database.all<FormQuestionRecord>(
        `SELECT * FROM pregunta_cache
         WHERE formulario_id = ? AND version = ?`,
        [formId, version],
      );

      if (questions.length > 0) {
        const validQuestionIds = new Set(questions.map((q) => q.pregunta_id));
        for (const key of Object.keys(answers)) {
          if (!validQuestionIds.has(key)) {
            throw new Error(`La clave '${key}' no pertenece a la definición de este cuestionario.`);
          }
        }
      }

      const normalizedAnswers =
        questions.length > 0 ? normalizeFormQuestionsRecords(questions, answers) : answers;

      const timestamp = now();
      const payload = JSON.stringify(normalizedAnswers);

      await database.run(
        `INSERT INTO borrador_formulario (
          paciente_id, formulario_id, version, periodo_clave, entrega_id, respuestas_json, guardado_en, version_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 2)
        ON CONFLICT (paciente_id, formulario_id, version, periodo_clave) DO UPDATE SET
          entrega_id = excluded.entrega_id,
          respuestas_json = excluded.respuestas_json,
          guardado_en = excluded.guardado_en,
          version_payload = excluded.version_payload`,
        [patientId, formId, version, periodoClave, deliveryId, payload, timestamp],
      );
    },

    async getDraft(
      formId: string,
      version: string,
      periodoClave = 'legacy',
    ): Promise<{
      entregaId: string;
      respuestas: Record<string, FormAnswerValue>;
      guardadoEn: string;
      periodoClave?: string;
    } | null> {
      const row = await database.first<FormDraftRecord>(
        `SELECT * FROM borrador_formulario
         WHERE paciente_id = ? AND formulario_id = ? AND version = ? AND periodo_clave = ?`,
        [patientId, formId, version, periodoClave],
      );
      if (!row) return null;

      try {
        const respuestas = JSON.parse(row.respuestas_json);
        return {
          entregaId: row.entrega_id,
          respuestas,
          guardadoEn: row.guardado_en,
          periodoClave: row.periodo_clave,
        };
      } catch {
        return null;
      }
    },

    async discardDraft(formId: string, version: string, periodoClave = 'legacy'): Promise<void> {
      await database.run(
        `DELETE FROM borrador_formulario
         WHERE paciente_id = ? AND formulario_id = ? AND version = ? AND periodo_clave = ?`,
        [patientId, formId, version, periodoClave],
      );
    },

    async confirmSubmission(
      formId: string,
      version: string,
      answers: Record<string, FormAnswerValue>,
      deliveryId: string,
    ): Promise<string> {
      if (!deliveryId) throw new Error('El deliveryId es requerido para confirmar una entrega.');
      const timestamp = now();
      const queueId = newId();

      await database.transaction(async (tx) => {
        // 1. Verificar asignación activa
        const assignment = await tx.first<{ estado_conocido: string }>(
          `SELECT estado_conocido FROM formulario_asignacion_cache
           WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
          [patientId, formId, version],
        );
        if (!assignment || assignment.estado_conocido !== 'activa') {
          throw new Error('No existe una asignación activa para este cuestionario.');
        }

        // 2. Obtener preguntas para validación y normalización
        const questions = await tx.all<FormQuestionRecord>(
          `SELECT * FROM pregunta_cache
           WHERE formulario_id = ? AND version = ?`,
          [formId, version],
        );

        // 3. Validar preguntas y respuestas frente a la definición
        const validation = validateFormQuestionsRecords(questions, answers);
        if (!validation.isValid) {
          const firstError = Object.values(validation.errors)[0];
          throw new Error(`Validación fallida: ${firstError}`);
        }

        const normalizedAnswers = normalizeFormQuestionsRecords(questions, answers);

        // 4. Comprobar si ya existe una entrega con este deliveryId
        const existingSubmission = await tx.first<FormSubmissionRecord>(
          'SELECT * FROM respuesta_formulario WHERE id = ?',
          [deliveryId],
        );

        if (existingSubmission) {
          const samePatient = existingSubmission.paciente_id === patientId;
          const sameForm = existingSubmission.formulario_id === formId;
          const sameVersion = existingSubmission.version === version;

          let sameAnswers = false;
          try {
            const parsedExisting = JSON.parse(existingSubmission.respuestas_json);
            sameAnswers = areAnswersEqual(normalizedAnswers, parsedExisting);
          } catch {
            // Respuestas inválidas en el registro existente
          }

          if (samePatient && sameForm && sameVersion && sameAnswers) {
            // Éxito idempotente: se retorna el deliveryId sin duplicar la cola ni mutar
            return;
          }

          throw new ConflictoEntregaError(
            `El identificador de entrega '${deliveryId}' ya existe con datos diferentes.`,
          );
        }

        // 5. Inserción en respuesta_formulario
        const answersJson = JSON.stringify(normalizedAnswers);
        await tx.run(
          `INSERT INTO respuesta_formulario (
            id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [deliveryId, patientId, formId, version, answersJson, timestamp, timestamp],
        );

        // 6. Inserción en cola_envio
        const queuePayload = JSON.stringify({
          schemaVersion: 1,
          entity: 'respuesta_formulario',
          record: {
            id: deliveryId,
            paciente_id: patientId,
            formulario_id: formId,
            version,
            respuestas: normalizedAnswers,
            fecha_confirmacion: timestamp,
          },
        });

        await tx.run(
          `INSERT INTO cola_envio (
            id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
          ) VALUES (?, ?, 'respuesta_formulario', ?, ?, 'pendiente', ?, ?)`,
          [queueId, patientId, deliveryId, queuePayload, timestamp, timestamp],
        );

        // 7. Consumo condicional del borrador (solo si su entrega_id coincide con el deliveryId confirmado)
        await tx.run(
          `DELETE FROM borrador_formulario
           WHERE paciente_id = ? AND formulario_id = ? AND version = ? AND entrega_id = ?`,
          [patientId, formId, version, deliveryId],
        );
      });

      return deliveryId;
    },

    async getDailyFormStatus(formId: string, trackingDate?: string): Promise<DailyFormStatus> {
      const todayTrackingDate =
        trackingDate ?? getCivilDateInTimeZone(now(), DEFAULT_FORMS_TIMEZONE);
      const activePeriodKey = formatDailyPeriodKey(todayTrackingDate);

      // 1. Buscar entregas de hoy (por fecha_seguimiento civil o fecha_confirmacion en el mismo día civil)
      const lastSubmission = await database.first<FormSubmissionRecord>(
        `SELECT * FROM respuesta_formulario
         WHERE paciente_id = ? AND formulario_id = ?
           AND (fecha_seguimiento = ? OR fecha_confirmacion LIKE ?)
         ORDER BY fecha_confirmacion DESC, id DESC LIMIT 1`,
        [patientId, formId, todayTrackingDate, `${todayTrackingDate}%`],
      );

      // 2. Buscar borradores existentes
      const allDrafts = await database.all<FormDraftRecord>(
        `SELECT * FROM borrador_formulario
         WHERE paciente_id = ? AND formulario_id = ?
         ORDER BY guardado_en DESC`,
        [patientId, formId],
      );

      const activeDraft = allDrafts.find((d) => d.periodo_clave === activePeriodKey) ?? null;
      const olderDraft = allDrafts.find((d) => d.periodo_clave !== activePeriodKey) ?? null;

      return {
        hasSubmittedToday: Boolean(lastSubmission),
        hasActiveDraft: Boolean(activeDraft),
        hasOlderDraft: Boolean(olderDraft),
        activeDraft,
        olderDraft,
        lastSubmission: lastSubmission ?? null,
        todayTrackingDate,
      };
    },

    async getOrCreateDailyDraft(
      formId: string,
      version: string,
      dailyContext?: DailyFormContext,
    ): Promise<DailyDraftData> {
      const context = dailyContext ?? createDailyFormContext({ now: now() });

      // Verificar si ya existe el borrador en SQLite
      const existing = await database.first<FormDraftRecord>(
        `SELECT * FROM borrador_formulario
         WHERE paciente_id = ? AND formulario_id = ? AND version = ? AND periodo_clave = ?`,
        [patientId, formId, version, context.periodoClave],
      );

      if (existing) {
        let respuestas: Record<string, FormAnswerValue>;
        try {
          respuestas = JSON.parse(existing.respuestas_json);
        } catch {
          respuestas = {};
        }

        // Recuperar directamente sin recalcular metadatos temporales
        return {
          formId: existing.formulario_id,
          version: existing.version,
          periodoClave: existing.periodo_clave,
          entregaId: existing.entrega_id,
          fechaSeguimiento: existing.fecha_seguimiento ?? context.fechaSeguimiento,
          zonaHoraria: existing.zona_horaria ?? context.zonaHoraria,
          iniciadoEn: existing.iniciado_en ?? existing.guardado_en,
          ventanaDesde: existing.ventana_desde ?? context.ventanaDesde,
          ventanaHasta: existing.ventana_hasta ?? context.ventanaHasta,
          pasoActual: existing.paso_actual,
          respuestas,
          guardadoEn: existing.guardado_en,
        };
      }

      // Validar asignación activa
      const assignment = await database.first<{ estado_conocido: string }>(
        `SELECT estado_conocido FROM formulario_asignacion_cache
         WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
        [patientId, formId, version],
      );
      if (!assignment || assignment.estado_conocido !== 'activa') {
        throw new Error('No existe una asignación activa para este cuestionario.');
      }

      const deliveryId = newId();
      const timestamp = now();

      await database.run(
        `INSERT INTO borrador_formulario (
          paciente_id, formulario_id, version, periodo_clave,
          fecha_seguimiento, zona_horaria, iniciado_en, ventana_desde, ventana_hasta, paso_actual,
          entrega_id, respuestas_json, guardado_en, version_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '{}', ?, 2)`,
        [
          patientId,
          formId,
          version,
          context.periodoClave,
          context.fechaSeguimiento,
          context.zonaHoraria,
          context.iniciadoEn,
          context.ventanaDesde,
          context.ventanaHasta,
          deliveryId,
          timestamp,
        ],
      );

      return {
        formId,
        version,
        periodoClave: context.periodoClave,
        entregaId: deliveryId,
        fechaSeguimiento: context.fechaSeguimiento,
        zonaHoraria: context.zonaHoraria,
        iniciadoEn: context.iniciadoEn,
        ventanaDesde: context.ventanaDesde,
        ventanaHasta: context.ventanaHasta,
        pasoActual: null,
        respuestas: {},
        guardadoEn: timestamp,
      };
    },

    async saveDailyDraft(
      draftIdentity: { formId: string; version: string; periodoClave: string },
      answers: Record<string, FormAnswerValue>,
      currentSection?: string | null,
    ): Promise<void> {
      const { formId, version, periodoClave } = draftIdentity;

      const questions = await database.all<FormQuestionRecord>(
        `SELECT * FROM pregunta_cache
         WHERE formulario_id = ? AND version = ?`,
        [formId, version],
      );

      if (questions.length > 0) {
        const validQuestionIds = new Set(questions.map((q) => q.pregunta_id));
        for (const key of Object.keys(answers)) {
          if (!validQuestionIds.has(key)) {
            throw new Error(`La clave '${key}' no pertenece a la definición de este cuestionario.`);
          }
        }
      }

      const normalizedAnswers =
        questions.length > 0 ? normalizeFormQuestionsRecords(questions, answers) : answers;

      const timestamp = now();
      const payload = JSON.stringify(normalizedAnswers);

      await database.run(
        `UPDATE borrador_formulario
         SET respuestas_json = ?,
             guardado_en = ?,
             paso_actual = COALESCE(?, paso_actual)
         WHERE paciente_id = ? AND formulario_id = ? AND version = ? AND periodo_clave = ?`,
        [payload, timestamp, currentSection ?? null, patientId, formId, version, periodoClave],
      );
    },

    async confirmDailySubmission(
      draftIdentity: {
        formId: string;
        version: string;
        periodoClave: string;
        deliveryId: string;
      },
      answers: Record<string, FormAnswerValue>,
    ): Promise<string> {
      const { formId, version, periodoClave, deliveryId } = draftIdentity;
      if (!deliveryId)
        throw new Error('El deliveryId es requerido para confirmar el seguimiento diario.');

      // 1. Recuperar el borrador persistido para heredar sus metadatos temporales
      const draft = await database.first<FormDraftRecord>(
        `SELECT * FROM borrador_formulario
         WHERE paciente_id = ? AND formulario_id = ? AND version = ? AND periodo_clave = ? AND entrega_id = ?`,
        [patientId, formId, version, periodoClave, deliveryId],
      );

      const timestamp = now();
      const queueId = newId();

      await database.transaction(async (tx) => {
        // 2. Verificar asignación activa
        const assignment = await tx.first<{ estado_conocido: string }>(
          `SELECT estado_conocido FROM formulario_asignacion_cache
           WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
          [patientId, formId, version],
        );
        if (!assignment || assignment.estado_conocido !== 'activa') {
          throw new Error('No existe una asignación activa para este cuestionario.');
        }

        // 3. Obtener preguntas para validación
        const questions = await tx.all<FormQuestionRecord>(
          `SELECT * FROM pregunta_cache
           WHERE formulario_id = ? AND version = ?`,
          [formId, version],
        );

        const validation = validateFormQuestionsRecords(questions, answers);
        if (!validation.isValid) {
          const firstError = Object.values(validation.errors)[0];
          throw new Error(`Validación fallida: ${firstError}`);
        }

        const normalizedAnswers = normalizeFormQuestionsRecords(questions, answers);

        // 4. Idempotencia ante reintentos
        const existing = await tx.first<FormSubmissionRecord>(
          'SELECT * FROM respuesta_formulario WHERE id = ?',
          [deliveryId],
        );

        if (existing) {
          let sameAnswers = false;
          try {
            const parsedExisting = JSON.parse(existing.respuestas_json);
            sameAnswers = areAnswersEqual(normalizedAnswers, parsedExisting);
          } catch {
            // error al parsear
          }

          if (
            existing.paciente_id === patientId &&
            existing.formulario_id === formId &&
            existing.version === version &&
            sameAnswers
          ) {
            return;
          }

          throw new ConflictoEntregaError(
            `El identificador de entrega '${deliveryId}' ya existe con datos diferentes.`,
          );
        }

        // 5. Inserción con contexto temporal heredado del borrador
        const fechaSeguimiento =
          draft?.fecha_seguimiento ?? getCivilDateInTimeZone(timestamp, DEFAULT_FORMS_TIMEZONE);
        const zonaHoraria = draft?.zona_horaria ?? DEFAULT_FORMS_TIMEZONE;
        const iniciadoEn = draft?.iniciado_en ?? timestamp;
        const ventanaDesde =
          draft?.ventana_desde ??
          new Date(new Date(iniciadoEn).getTime() - 24 * 60 * 60 * 1000).toISOString();
        const ventanaHasta = draft?.ventana_hasta ?? iniciadoEn;

        const answersJson = JSON.stringify(normalizedAnswers);

        await tx.run(
          `INSERT INTO respuesta_formulario (
            id, paciente_id, formulario_id, version, respuestas_json,
            fecha_confirmacion, creado_localmente_en,
            fecha_seguimiento, zona_horaria, iniciado_en, ventana_desde, ventana_hasta
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            deliveryId,
            patientId,
            formId,
            version,
            answersJson,
            timestamp,
            timestamp,
            fechaSeguimiento,
            zonaHoraria,
            iniciadoEn,
            ventanaDesde,
            ventanaHasta,
          ],
        );

        // 6. Encolado para sincronización
        const queuePayload = JSON.stringify({
          schemaVersion: 2,
          entity: 'respuesta_formulario',
          record: {
            id: deliveryId,
            paciente_id: patientId,
            formulario_id: formId,
            version,
            periodo_clave: periodoClave,
            fecha_seguimiento: fechaSeguimiento,
            zonaHoraria,
            iniciado_en: iniciadoEn,
            ventana_desde: ventanaDesde,
            ventana_hasta: ventanaHasta,
            respuestas: normalizedAnswers,
            fecha_confirmacion: timestamp,
          },
        });

        await tx.run(
          `INSERT INTO cola_envio (
            id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
          ) VALUES (?, ?, 'respuesta_formulario', ?, ?, 'pendiente', ?, ?)`,
          [queueId, patientId, deliveryId, queuePayload, timestamp, timestamp],
        );

        // 7. Eliminación condicional del borrador
        await tx.run(
          `DELETE FROM borrador_formulario
           WHERE paciente_id = ? AND formulario_id = ? AND version = ? AND periodo_clave = ? AND entrega_id = ?`,
          [patientId, formId, version, periodoClave, deliveryId],
        );
      });

      return deliveryId;
    },

    async listSubmissions(
      formId?: string,
      limit = 30,
      offset = 0,
    ): Promise<
      Array<{
        id: string;
        formulario_id: string;
        version: string;
        titulo: string;
        duracion_estimada_min: number;
        fecha_confirmacion: string;
        estado_envio: string | null;
      }>
    > {
      return database.all(
        `SELECT
           r.id,
           r.formulario_id,
           r.version,
           f.titulo,
           f.duracion_estimada_min,
           r.fecha_confirmacion,
           c.estado AS estado_envio
         FROM respuesta_formulario r
         JOIN formulario_cache f
           ON f.formulario_id = r.formulario_id AND f.version = r.version
         LEFT JOIN cola_envio c
           ON c.tipo_entidad = 'respuesta_formulario' AND c.registro_id = r.id
         WHERE r.paciente_id = ? AND (? IS NULL OR r.formulario_id = ?)
         ORDER BY r.fecha_confirmacion DESC, r.id DESC
         LIMIT ? OFFSET ?`,
        [patientId, formId ?? null, formId ?? null, limit, offset],
      );
    },

    async getSubmission(id: string): Promise<FormSubmissionDetail | null> {
      const row = await database.first<
        FormSubmissionRecord & {
          titulo: string;
          descripcion: string;
          estado_envio: string | null;
        }
      >(
        `SELECT
           r.*,
           f.titulo,
           f.descripcion,
           c.estado AS estado_envio
         FROM respuesta_formulario r
         JOIN formulario_cache f
           ON f.formulario_id = r.formulario_id AND f.version = r.version
         LEFT JOIN cola_envio c
           ON c.tipo_entidad = 'respuesta_formulario' AND c.registro_id = r.id
         WHERE r.paciente_id = ? AND r.id = ?`,
        [patientId, id],
      );
      if (!row) return null;

      let respuestas: Record<string, FormAnswerValue>;
      try {
        respuestas = JSON.parse(row.respuestas_json);
      } catch {
        respuestas = {};
      }

      return {
        ...row,
        respuestas,
      };
    },
  };
}
