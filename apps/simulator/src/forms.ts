import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from './db.js';
import { one } from './db.js';
import { ApiError, invalid } from './errors.js';
import type { AnswerInput, FormDefinition, ObjectValue, Question } from './types.js';

const has = (value: ObjectValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const configOf = (q: Question): ObjectValue => {
  if (q.configuracion === undefined) return {};
  if (
    typeof q.configuracion !== 'object' ||
    q.configuracion === null ||
    Array.isArray(q.configuracion)
  ) {
    invalid('Configuración de pregunta debe ser un objeto.', 'DEFINICION_CONDICIONAL_INVALIDA');
  }
  return q.configuracion;
};

/** Derive only persisted editions. Presence, including false/null, is not truthiness. */
export function conditionsVersion(config: ObjectValue, questions: Question[]): 0 | 1 {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    invalid('Configuración de edición debe ser un objeto.', 'DEFINICION_CONDICIONAL_INVALIDA');
  }
  const hasConditions = questions.some(
    (q) => has(configOf(q), 'valor_activador') || has(configOf(q), 'requerida_si_activa'),
  );
  if (has(config, 'version_condiciones')) {
    const marker = config.version_condiciones;
    if (marker !== 0 && marker !== 1)
      invalid('Marcador de condiciones inválido.', 'CONFIGURACION_INVALIDA');
    if (marker === 0 && hasConditions)
      invalid('Contrato 0 incompatible con condiciones.', 'CONFIGURACION_INVALIDA');
    return marker;
  }
  return hasConditions ? 1 : 0;
}

export function validateDefinition(form: FormDefinition): void {
  if (form.version_condiciones !== 0 && form.version_condiciones !== 1)
    invalid('Versión de condiciones inválida.', 'CONFIGURACION_INVALIDA');
  const codes = new Map(form.preguntas.map((q) => [q.codigo, q]));
  if (
    codes.size !== form.preguntas.length ||
    new Set(form.preguntas.map((q) => q.id)).size !== codes.size
  ) {
    invalid('Identidades duplicadas en definición.', 'CONFIGURACION_INVALIDA');
  }
  for (const q of form.preguntas) {
    const c = configOf(q);
    const options = (q.opciones ?? []).map((o) => o.codigo);
    if (new Set(options).size !== options.length)
      invalid('Opciones duplicadas.', 'CONFIGURACION_INVALIDA');
    const exclusive = c.opciones_exclusivas;
    if (exclusive !== undefined) {
      if (
        form.version_condiciones !== 1 ||
        q.tipo !== 'opcion_multiple' ||
        !Array.isArray(exclusive) ||
        exclusive.some((code) => typeof code !== 'string' || !options.includes(code)) ||
        new Set(exclusive).size !== exclusive.length
      )
        invalid('Exclusividad inválida.', 'CONFIGURACION_INVALIDA');
    }
    const executable = has(c, 'valor_activador') || has(c, 'requerida_si_activa');
    if (form.version_condiciones === 0) {
      if (executable) invalid('Condiciones no permitidas en contrato 0.', 'CONFIGURACION_INVALIDA');
      continue;
    }
    if (has(c, 'depende_de') || executable) {
      if (
        typeof c.depende_de !== 'string' ||
        !has(c, 'valor_activador') ||
        typeof c.requerida_si_activa !== 'boolean'
      ) {
        invalid('Dependencia incompleta.', 'CONFIGURACION_INVALIDA');
      }
      const parent = codes.get(c.depende_de);
      if (
        !parent ||
        parent.id === q.id ||
        !['booleano', 'numerico', 'opcion_unica', 'escala_likert'].includes(parent.tipo)
      ) {
        invalid('Dependencia no ejecutable.', 'CONFIGURACION_INVALIDA');
      }
      const value = c.valor_activador;
      if (
        (parent.tipo === 'booleano' && typeof value !== 'boolean') ||
        (parent.tipo === 'numerico' && (typeof value !== 'number' || !Number.isFinite(value))) ||
        (['opcion_unica', 'escala_likert'].includes(parent.tipo) &&
          (typeof value !== 'string' || !(parent.opciones ?? []).some((o) => o.codigo === value)))
      ) {
        invalid('Activador incompatible.', 'CONFIGURACION_INVALIDA');
      }
      const seen = new Set([q.codigo]);
      let ancestor: Question | undefined = parent;
      while (ancestor) {
        if (seen.has(ancestor.codigo)) invalid('Ciclo de condiciones.', 'CONFIGURACION_INVALIDA');
        seen.add(ancestor.codigo);
        const next: unknown = configOf(ancestor).depende_de;
        ancestor = typeof next === 'string' ? codes.get(next) : undefined;
      }
    }
  }
}

export async function loadForm(client: SqlClient, id: string): Promise<FormDefinition> {
  const row = await one<{
    id: string;
    codigo: string;
    titulo: string;
    descripcion: string | null;
    tratamiento: string;
    version: number;
    activo: boolean;
    configuracion: ObjectValue;
    fecha_creacion: Date;
  }>(client, 'SELECT * FROM formulario WHERE id=$1 AND eliminado=false', [id]);
  if (!row) throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Formulario no encontrado.');
  const questions = (
    await client.query<Question>(
      `SELECT id,codigo,titulo,texto,tipo,requerida,orden,opciones,configuracion
    FROM pregunta WHERE formulario_id=$1 AND eliminado=false ORDER BY orden,id`,
      [id],
    )
  ).rows;
  const form: FormDefinition = {
    id: row.id,
    codigo: row.codigo,
    titulo: row.titulo,
    descripcion: row.descripcion,
    tratamiento: row.tratamiento,
    version: row.version,
    activo: row.activo,
    fecha_creacion: row.fecha_creacion.toISOString(),
    preguntas: questions,
    version_condiciones: conditionsVersion(row.configuracion, questions),
  };
  // The exclusive extension requires an explicit marker, not just derived version1.
  if (
    questions.some((q) => has(configOf(q), 'opciones_exclusivas')) &&
    row.configuracion.version_condiciones !== 1
  ) {
    invalid('Exclusividad sin marcador explícito.', 'CONFIGURACION_INVALIDA');
  }
  validateDefinition(form);
  return form;
}

function checkAnswer(question: Question, value: unknown): void {
  const config = configOf(question);
  switch (question.tipo) {
    case 'booleano':
      if (typeof value !== 'boolean')
        invalid('Valor booleano inválido.', 'TIPO_RESPUESTA_INVALIDO');
      break;
    case 'numerico':
      if (typeof value !== 'number' || !Number.isFinite(value))
        invalid('Valor numérico inválido.', 'TIPO_RESPUESTA_INVALIDO');
      if (
        (typeof config.min_value === 'number' && value < config.min_value) ||
        (typeof config.max_value === 'number' && value > config.max_value)
      )
        invalid('Número fuera de límites.', 'VALOR_FUERA_DE_RANGO');
      break;
    case 'texto_libre':
      if (typeof value !== 'string') invalid('Texto inválido.', 'TIPO_RESPUESTA_INVALIDO');
      if (typeof config.max_length === 'number' && Array.from(value).length > config.max_length)
        invalid('Texto demasiado largo.', 'LONGITUD_EXCEDIDA');
      break;
    case 'opcion_unica':
    case 'escala_likert':
      if (typeof value !== 'string' || !(question.opciones ?? []).some((o) => o.codigo === value))
        invalid('Código de opción inválido.', 'OPCION_INVALIDA');
      break;
    case 'opcion_multiple': {
      const options = (question.opciones ?? []).map((o) => o.codigo);
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !options.includes(v)))
        invalid('Selección múltiple inválida.', 'OPCION_INVALIDA');
      const exclusive = config.opciones_exclusivas;
      if (
        Array.isArray(exclusive) &&
        value.some((v) => exclusive.includes(v)) &&
        value.length !== 1
      ) {
        throw new ApiError(
          422,
          'REGLA_DE_NEGOCIO_INVALIDA',
          'La opción exclusiva debe seleccionarse sola.',
          {
            motivo: 'OPCIONES_EXCLUSIVAS_INCOMPATIBLES',
            pregunta_id: question.id,
            codigo_pregunta: question.codigo,
          },
        );
      }
      if (new Set(value).size !== value.length) invalid('Selección duplicada.', 'OPCION_INVALIDA');
      break;
    }
    default:
      invalid('Tipo de pregunta no admitido.', 'CONFIGURACION_INVALIDA');
  }
}

export function validateAnswers(form: FormDefinition, answers: AnswerInput[]) {
  validateDefinition(form);
  const byId = new Map(answers.map((a) => [a.pregunta_id, a]));
  if (byId.size !== answers.length) invalid('Preguntas repetidas.', 'PREGUNTA_DUPLICADA');
  const definitionIds = new Set(form.preguntas.map((q) => q.id));
  if (answers.some((a) => !definitionIds.has(a.pregunta_id)))
    invalid('Pregunta ajena a la edición.', 'PREGUNTA_NO_PERTENECE');
  const byCode = new Map(form.preguntas.map((q) => [q.codigo, q]));
  const active = (question: Question): boolean => {
    const c = configOf(question);
    if (form.version_condiciones === 0 || typeof c.depende_de !== 'string') return true;
    const parent = byCode.get(c.depende_de)!;
    const parentValue = byId.get(parent.id)?.valor;
    return (
      active(parent) &&
      parentValue !== null &&
      parentValue !== undefined &&
      isDeepStrictEqual(parentValue, c.valor_activador)
    );
  };
  for (const question of form.preguntas) {
    const answer = byId.get(question.id);
    if (!active(question)) {
      if (answer !== undefined)
        throw new ApiError(422, 'PREGUNTA_NO_APLICABLE', 'La pregunta indicada no aplica.', {
          motivo: 'PREGUNTA_NO_APLICABLE',
          pregunta_id: question.id,
          codigo_pregunta: question.codigo,
        });
      continue;
    }
    const c = configOf(question);
    const required =
      form.version_condiciones === 1 && typeof c.depende_de === 'string'
        ? c.requerida_si_activa === true
        : question.requerida !== false;
    const missing =
      !answer ||
      answer.valor === null ||
      answer.valor === undefined ||
      (typeof answer.valor === 'string' && !answer.valor.trim()) ||
      (Array.isArray(answer.valor) && answer.valor.length === 0);
    if (required && missing)
      throw new ApiError(422, 'REGLA_DE_NEGOCIO_INVALIDA', 'Falta una respuesta obligatoria.', {
        motivo: answer ? 'PREGUNTA_REQUERIDA_VACIA' : 'PREGUNTA_REQUERIDA_FALTANTE',
        pregunta_id: question.id,
        codigo_pregunta: question.codigo,
      });
    if (answer && answer.valor !== null && answer.valor !== undefined)
      checkAnswer(question, answer.valor);
  }
  return form.preguntas
    .filter((q) => byId.has(q.id))
    .map((q) => {
      const answer = byId.get(q.id)!;
      return {
        pregunta_id: q.id,
        codigo_pregunta: q.codigo,
        texto_pregunta: q.titulo,
        tipo_pregunta: q.tipo,
        valor: answer.valor,
        valor_texto: answer.valor_texto ?? null,
      };
    });
}
