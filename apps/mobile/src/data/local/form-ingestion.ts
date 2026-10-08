import type { SqlConnection } from './sql';
import {
  type FormDefinitionRecord,
  type FormQuestionRecord,
  type MedicalFormBundle,
  type MedicalFormQuestionType,
  SUPPORTED_QUESTION_TYPES,
  TipoPreguntaNoSoportadoError,
  VersionInmutableError,
} from './form-types';

export type Clock = () => string;

function normalizeConfig(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  return JSON.stringify(raw);
}

export async function ingestMedicalFormBundle(
  connection: SqlConnection,
  bundle: MedicalFormBundle,
  now: Clock = () => new Date().toISOString(),
): Promise<void> {
  const timestamp = now();
  const forms = bundle.formularios ?? [];
  const assignments = bundle.asignaciones ?? [];

  // 1. Validación previa de tipos de pregunta soportados
  for (const form of forms) {
    for (const q of form.preguntas) {
      if (!SUPPORTED_QUESTION_TYPES.includes(q.tipo as MedicalFormQuestionType)) {
        throw new TipoPreguntaNoSoportadoError(
          `Tipo de pregunta no soportado: '${q.tipo}' en pregunta '${q.preguntaId}' del formulario '${form.formularioId}'.`,
        );
      }
    }
  }

  // 2. Ingestión y verificación de inmutabilidad de formularios y preguntas
  for (const form of forms) {
    const existing = await connection.first<FormDefinitionRecord>(
      'SELECT * FROM formulario_cache WHERE formulario_id = ? AND version = ?',
      [form.formularioId, form.version],
    );

    if (existing) {
      // Verificar inmutabilidad de la definición
      const sameTitle = existing.titulo === form.titulo;
      const sameDesc = existing.descripcion === form.descripcion;
      const sameDuration = existing.duracion_estimada_min === form.duracionEstimadaMin;
      const sameConfig = existing.configuracion_json === normalizeConfig(form.configuracion);

      if (!sameTitle || !sameDesc || !sameDuration || !sameConfig) {
        throw new VersionInmutableError(
          `La versión '${form.version}' del formulario '${form.formularioId}' ya existe con una definición diferente.`,
        );
      }

      // Verificar inmutabilidad de las preguntas
      const existingQuestions = await connection.all<FormQuestionRecord>(
        'SELECT * FROM pregunta_cache WHERE formulario_id = ? AND version = ? ORDER BY orden ASC',
        [form.formularioId, form.version],
      );

      if (existingQuestions.length !== form.preguntas.length) {
        throw new VersionInmutableError(
          `La versión '${form.version}' del formulario '${form.formularioId}' difiere en la cantidad de preguntas.`,
        );
      }

      for (const q of form.preguntas) {
        const match = existingQuestions.find((eq) => eq.pregunta_id === q.preguntaId);
        if (!match) {
          throw new VersionInmutableError(
            `La versión '${form.version}' del formulario '${form.formularioId}' no coincide en la pregunta '${q.preguntaId}'.`,
          );
        }
        const sameText = match.texto === q.texto;
        const sameType = match.tipo === q.tipo;
        const sameOrder = match.orden === q.orden;
        const sameRequired = match.requerida === (q.requerida ? 1 : 0);
        const sameQConfig = match.configuracion_json === normalizeConfig(q.configuracion);

        if (!sameText || !sameType || !sameOrder || !sameRequired || !sameQConfig) {
          throw new VersionInmutableError(
            `El contenido de la pregunta '${q.preguntaId}' en la versión '${form.version}' del formulario '${form.formularioId}' difiere del existente.`,
          );
        }
      }
    } else {
      // Inserción de formulario nuevo
      await connection.run(
        `INSERT INTO formulario_cache (
          formulario_id, version, titulo, descripcion, duracion_estimada_min, configuracion_json, retirado, obtenido_en
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          form.formularioId,
          form.version,
          form.titulo,
          form.descripcion,
          form.duracionEstimadaMin,
          normalizeConfig(form.configuracion),
          timestamp,
        ],
      );

      // Inserción de sus preguntas
      for (const q of form.preguntas) {
        await connection.run(
          `INSERT INTO pregunta_cache (
            formulario_id, version, pregunta_id, texto, descripcion, tipo, orden, requerida, configuracion_json, retirado
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            form.formularioId,
            form.version,
            q.preguntaId,
            q.texto,
            q.descripcion ?? null,
            q.tipo,
            q.orden,
            q.requerida ? 1 : 0,
            normalizeConfig(q.configuracion),
          ],
        );
      }
    }
  }

  // 3. Procesamiento de asignaciones
  for (const a of assignments) {
    const existingAssign = await connection.first<{ estado_conocido: string }>(
      'SELECT estado_conocido FROM formulario_asignacion_cache WHERE paciente_id = ? AND formulario_id = ? AND version = ?',
      [a.pacienteId, a.formularioId, a.version],
    );

    if (existingAssign) {
      // Si se especificó explícitamente un cambio de estado en el lote, actualizarlo
      if (a.estado && a.estado !== existingAssign.estado_conocido) {
        await connection.run(
          `UPDATE formulario_asignacion_cache
           SET estado_conocido = ?, obtenido_en = ?
           WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
          [a.estado, timestamp, a.pacienteId, a.formularioId, a.version],
        );
      }
    } else {
      // Inserción de nueva asignación (por defecto 'activa' si no se especifica)
      await connection.run(
        `INSERT INTO formulario_asignacion_cache (
          paciente_id, formulario_id, version, estado_conocido, asignacion_origen_id, obtenido_en
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          a.pacienteId,
          a.formularioId,
          a.version,
          a.estado ?? 'activa',
          a.asignacionOrigenId ?? null,
          timestamp,
        ],
      );
    }
  }
}
