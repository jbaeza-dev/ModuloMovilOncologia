import type { SqlConnection } from './sql';
import {
  type FormAnswerValue,
  type FormDefinitionRecord,
  type FormDraftRecord,
  type FormQuestionRecord,
  type FormSubmissionRecord,
  ConflictoEntregaError,
} from './form-types';

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
  ultima_entrega_id: string | null;
  ultima_fecha_confirmacion: string | null;
};

export type FullFormDefinition = FormDefinitionRecord & {
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
    async listAssignedForms(): Promise<AssignedFormSummary[]> {
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
           r.id AS ultima_entrega_id,
           r.fecha_confirmacion AS ultima_fecha_confirmacion
         FROM formulario_asignacion_cache a
         JOIN formulario_cache f
           ON f.formulario_id = a.formulario_id AND f.version = a.version
         LEFT JOIN borrador_formulario b
           ON b.paciente_id = a.paciente_id AND b.formulario_id = a.formulario_id AND b.version = a.version
         LEFT JOIN (
           SELECT id, paciente_id, formulario_id, version, fecha_confirmacion
           FROM respuesta_formulario
           WHERE (paciente_id, formulario_id, version, fecha_confirmacion) IN (
             SELECT paciente_id, formulario_id, version, MAX(fecha_confirmacion)
             FROM respuesta_formulario
             GROUP BY paciente_id, formulario_id, version
           )
         ) r ON r.paciente_id = a.paciente_id AND r.formulario_id = a.formulario_id AND r.version = a.version
         WHERE a.paciente_id = ? AND a.estado_conocido = 'activa'
         ORDER BY f.titulo ASC`,
        [patientId],
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

      return {
        ...def,
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
    ): Promise<void> {
      if (!deliveryId) throw new Error('El deliveryId es requerido para guardar un borrador.');
      const timestamp = now();
      const payload = JSON.stringify(answers);

      await database.run(
        `INSERT INTO borrador_formulario (
          paciente_id, formulario_id, version, entrega_id, respuestas_json, guardado_en, version_payload
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT (paciente_id, formulario_id, version) DO UPDATE SET
          entrega_id = excluded.entrega_id,
          respuestas_json = excluded.respuestas_json,
          guardado_en = excluded.guardado_en,
          version_payload = excluded.version_payload`,
        [patientId, formId, version, deliveryId, payload, timestamp],
      );
    },

    async getDraft(
      formId: string,
      version: string,
    ): Promise<{
      entregaId: string;
      respuestas: Record<string, FormAnswerValue>;
      guardadoEn: string;
    } | null> {
      const row = await database.first<FormDraftRecord>(
        `SELECT * FROM borrador_formulario
         WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
        [patientId, formId, version],
      );
      if (!row) return null;

      try {
        const respuestas = JSON.parse(row.respuestas_json);
        return {
          entregaId: row.entrega_id,
          respuestas,
          guardadoEn: row.guardado_en,
        };
      } catch {
        return null;
      }
    },

    async discardDraft(formId: string, version: string): Promise<void> {
      await database.run(
        `DELETE FROM borrador_formulario
         WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
        [patientId, formId, version],
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

        // 2. Comprobar si ya existe una entrega con este deliveryId
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
            sameAnswers =
              JSON.stringify(normalizeAnswers(answers)) ===
              JSON.stringify(normalizeAnswers(parsedExisting));
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

        // 3. Validar preguntas obligatorias de la definición
        const questions = await tx.all<FormQuestionRecord>(
          `SELECT * FROM pregunta_cache
           WHERE formulario_id = ? AND version = ?`,
          [formId, version],
        );

        for (const q of questions) {
          if (q.requerida === 1) {
            const val = answers[q.pregunta_id];
            if (val === undefined || val === null || val === '') {
              throw new Error(`La pregunta obligatoria '${q.texto}' no ha sido respondida.`);
            }
          }
        }

        // 4. Inserción en respuesta_formulario
        const answersJson = JSON.stringify(answers);
        await tx.run(
          `INSERT INTO respuesta_formulario (
            id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [deliveryId, patientId, formId, version, answersJson, timestamp, timestamp],
        );

        // 5. Inserción en cola_envio
        const queuePayload = JSON.stringify({
          schemaVersion: 1,
          entity: 'respuesta_formulario',
          record: {
            id: deliveryId,
            paciente_id: patientId,
            formulario_id: formId,
            version,
            respuestas: answers,
            fecha_confirmacion: timestamp,
          },
        });

        await tx.run(
          `INSERT INTO cola_envio (
            id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
          ) VALUES (?, ?, 'respuesta_formulario', ?, ?, 'pendiente', ?, ?)`,
          [queueId, patientId, deliveryId, queuePayload, timestamp, timestamp],
        );

        // 6. Consumo condicional del borrador (solo si su entrega_id coincide con el deliveryId confirmado)
        await tx.run(
          `DELETE FROM borrador_formulario
           WHERE paciente_id = ? AND formulario_id = ? AND version = ? AND entrega_id = ?`,
          [patientId, formId, version, deliveryId],
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
      const row = await database.first<{
        id: string;
        paciente_id: string;
        formulario_id: string;
        version: string;
        respuestas_json: string;
        fecha_confirmacion: string;
        creado_localmente_en: string;
        titulo: string;
        descripcion: string;
        estado_envio: string | null;
      }>(
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
