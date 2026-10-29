/** Mobile-safe clinical form semantics. No filesystem, network, UI or Node dependencies. */
export interface FormQuestion {
  id: string;
  codigo: string;
  titulo: string;
  texto?: string | null;
  tipo: string;
  requerida?: boolean;
  orden: number;
  opciones?: { codigo: string; etiqueta: string; orden?: number }[];
  configuracion?: Record<string, unknown>;
}
export interface FormEdition {
  id: string;
  version: number;
  version_condiciones: number;
  version_reglas_compuestas?: number;
  preguntas: FormQuestion[];
}
export interface FormAnswer {
  pregunta_id: string;
  valor: unknown;
  valor_texto?: string | null;
}
export type AnswerValue = string | number | boolean | string[] | null;
export class FormRuleError extends Error {
  readonly details: Record<string, unknown>;
  constructor(
    readonly reason: string,
    message: string,
    question?: FormQuestion,
    readonly code = 'REGLA_DE_NEGOCIO_INVALIDA',
  ) {
    super(message);
    this.name = 'FormRuleError';
    this.details = {
      motivo: reason,
      ...(question ? { pregunta_id: question.id, codigo_pregunta: question.codigo } : {}),
    };
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key);
function fail(reason: string, message: string, q?: FormQuestion): never {
  throw new FormRuleError(reason, message, q);
}
export function questionConfiguration(q: FormQuestion): Record<string, unknown> {
  if (q.configuracion === undefined) return {};
  if (!object(q.configuracion))
    fail(
      'DEFINICION_CONDICIONAL_INVALIDA',
      'La configuración de la pregunta debe ser un objeto.',
      q,
    );
  return q.configuracion;
}
/** Derive persisted legacy editions by presence, never truthiness or coercion. */
export function deriveConditionsVersion(
  config: Record<string, unknown>,
  questions: FormQuestion[],
): 0 | 1 {
  if (!object(config))
    fail('DEFINICION_CONDICIONAL_INVALIDA', 'Configuración de edición inválida.');
  const conditional = questions.some((q) => {
    const c = questionConfiguration(q);
    return has(c, 'valor_activador') || has(c, 'requerida_si_activa');
  });
  const version = has(config, 'version_condiciones')
    ? config.version_condiciones
    : conditional
      ? 1
      : 0;
  if (version !== 0 && version !== 1)
    fail('CONFIGURACION_INVALIDA', 'Marcador de condiciones inválido.');
  if (version === 0 && conditional)
    fail('CONFIGURACION_INVALIDA', 'La edición legada no puede ocultar condiciones.');
  if (
    has(config, 'version_reglas_compuestas') &&
    (config.version_reglas_compuestas !== 1 || config.version_condiciones !== 1)
  )
    fail(
      'CONFIGURACION_INVALIDA',
      'La ampliación compuesta requiere sus marcadores explícitos en versión 1.',
    );
  if (
    questions.some((q) => has(questionConfiguration(q), 'opciones_exclusivas')) &&
    config.version_condiciones !== 1
  )
    fail('CONFIGURACION_INVALIDA', 'Las opciones exclusivas requieren marcador explícito 1.');
  return version;
}
type Test = (answers: Map<string, FormAnswer>, active: (id: string) => boolean) => boolean;
function compile(form: FormEdition) {
  if (
    typeof form.id !== 'string' ||
    !form.id ||
    !Number.isInteger(form.version) ||
    form.version < 1 ||
    !Array.isArray(form.preguntas) ||
    !form.preguntas.length
  )
    fail('CONFIGURACION_INVALIDA', 'Identidad o edición del formulario inválida.');
  if (form.version_condiciones !== 0 && form.version_condiciones !== 1)
    fail('CONFIGURACION_INVALIDA', 'Versión de condiciones inválida.');
  if (
    form.version_reglas_compuestas !== undefined &&
    (form.version_reglas_compuestas !== 1 || form.version_condiciones !== 1)
  )
    fail('CONFIGURACION_INVALIDA', 'Versión de reglas compuestas no compatible.');
  const codes = new Map(form.preguntas.map((q) => [q.codigo, q]));
  if (
    codes.size !== form.preguntas.length ||
    new Set(form.preguntas.map((q) => q.id)).size !== codes.size
  )
    fail('CONFIGURACION_INVALIDA', 'Identidades duplicadas en la definición.');
  const tests = new Map<string, Test>(),
    edges = new Map<string, Set<string>>();
  for (const q of form.preguntas) {
    if (
      typeof q.id !== 'string' ||
      !q.id ||
      typeof q.codigo !== 'string' ||
      !q.codigo ||
      typeof q.titulo !== 'string' ||
      !q.titulo ||
      (q.requerida !== undefined && typeof q.requerida !== 'boolean') ||
      !Number.isInteger(q.orden) ||
      q.orden < 0 ||
      ![
        'booleano',
        'numerico',
        'texto_libre',
        'opcion_unica',
        'opcion_multiple',
        'escala_likert',
      ].includes(q.tipo)
    )
      fail('CONFIGURACION_INVALIDA', 'Tipo o identidad de pregunta no admitida.', q);
    const c = questionConfiguration(q),
      options = q.opciones ?? [];
    if (
      !Array.isArray(options) ||
      options.some(
        (o) =>
          !object(o) || typeof o.codigo !== 'string' || !o.codigo || typeof o.etiqueta !== 'string',
      ) ||
      new Set(options.map((o) => o.codigo)).size !== options.length
    )
      fail('CONFIGURACION_INVALIDA', 'Opciones de pregunta incompletas o duplicadas.', q);
    if (
      ['opcion_unica', 'opcion_multiple', 'escala_likert'].includes(q.tipo) &&
      options.length === 0
    )
      fail('CONFIGURACION_INVALIDA', 'La pregunta no tiene opciones publicadas.', q);
    for (const key of ['min_value', 'max_value', 'max_length'])
      if (
        has(c, key) &&
        (typeof c[key] !== 'number' ||
          !Number.isFinite(c[key]) ||
          (key === 'max_length' && (!Number.isInteger(c[key]) || Number(c[key]) < 0)))
      )
        fail('CONFIGURACION_INVALIDA', 'Límites de respuesta inválidos.', q);
    if (
      typeof c.min_value === 'number' &&
      typeof c.max_value === 'number' &&
      c.min_value > c.max_value
    )
      fail('CONFIGURACION_INVALIDA', 'Límites numéricos invertidos.', q);
    if (has(c, 'opciones_exclusivas')) {
      const list = c.opciones_exclusivas;
      if (
        form.version_condiciones !== 1 ||
        q.tipo !== 'opcion_multiple' ||
        !Array.isArray(list) ||
        list.some((v) => typeof v !== 'string' || !options.some((o) => o.codigo === v)) ||
        new Set(list).size !== list.length
      )
        fail('CONFIGURACION_INVALIDA', 'Exclusividad de edición inválida.', q);
    }
    const refs = new Set<string>();
    edges.set(q.id, refs);
    const comparison = (code: unknown, values: unknown[]): Test => {
      const parent = typeof code === 'string' ? codes.get(code) : undefined;
      if (
        !parent ||
        parent.id === q.id ||
        !['booleano', 'numerico', 'opcion_unica', 'escala_likert'].includes(parent.tipo)
      )
        fail('CONFIGURACION_INVALIDA', 'Dependencia condicional inválida o autorreferente.', q);
      if (
        values.some((value) =>
          parent.tipo === 'booleano'
            ? typeof value !== 'boolean'
            : parent.tipo === 'numerico'
              ? typeof value !== 'number' || !Number.isFinite(value)
              : typeof value !== 'string' ||
                !(parent.opciones ?? []).some((o) => o.codigo === value),
        )
      )
        fail(
          'CONFIGURACION_INVALIDA',
          'El activador no corresponde al tipo y las opciones de su madre.',
          q,
        );
      refs.add(parent.id);
      return (answers, active) => {
        const value = answers.get(parent.id)?.valor;
        return (
          active(parent.id) &&
          value !== null &&
          value !== undefined &&
          values.some((candidate) => value === candidate)
        );
      };
    };
    let nodes = 0;
    const compound = (value: unknown, depth = 0): Test => {
      if (++nodes > 64 || depth > 8 || !object(value))
        fail('CONFIGURACION_INVALIDA', 'Regla compuesta inválida o demasiado extensa.', q);
      if (value.op === 'todas') {
        if (
          Object.keys(value).some((k) => !['op', 'condiciones'].includes(k)) ||
          !Array.isArray(value.condiciones) ||
          value.condiciones.length === 0 ||
          value.condiciones.length > 16
        )
          fail('CONFIGURACION_INVALIDA', 'La regla todas requiere condiciones explícitas.', q);
        const children = value.condiciones.map((child) => compound(child, depth + 1));
        return (answers, active) => children.every((test) => test(answers, active));
      }
      if (value.op === 'igual') {
        if (
          Object.keys(value).some((k) => !['op', 'codigo', 'valor'].includes(k)) ||
          !has(value, 'valor')
        )
          fail('CONFIGURACION_INVALIDA', 'Comparación compuesta incompleta.', q);
        return comparison(value.codigo, [value.valor]);
      }
      if (value.op === 'en') {
        if (
          Object.keys(value).some((k) => !['op', 'codigo', 'valores'].includes(k)) ||
          !Array.isArray(value.valores) ||
          value.valores.length === 0 ||
          value.valores.length > 32 ||
          new Set(value.valores).size !== value.valores.length
        )
          fail(
            'CONFIGURACION_INVALIDA',
            'La regla en requiere una lista propia y sin duplicados.',
            q,
          );
        return comparison(value.codigo, value.valores);
      }
      return fail('CONFIGURACION_INVALIDA', 'Operador compuesto no admitido.', q);
    };
    const executable = has(c, 'valor_activador') || has(c, 'requerida_si_activa');
    if (has(c, 'activacion_compuesta')) {
      if (
        form.version_reglas_compuestas !== 1 ||
        form.version_condiciones !== 1 ||
        has(c, 'depende_de') ||
        has(c, 'valor_activador') ||
        typeof c.requerida_si_activa !== 'boolean'
      )
        fail(
          'CONFIGURACION_INVALIDA',
          'La regla compuesta requiere su ampliación explícita y no admite otra dependencia simultánea.',
          q,
        );
      tests.set(q.id, compound(c.activacion_compuesta));
    } else if (form.version_condiciones === 0) {
      if (executable)
        fail('CONFIGURACION_INVALIDA', 'Condiciones no permitidas en la edición legada.', q);
    } else if (has(c, 'depende_de') || executable) {
      if (!has(c, 'valor_activador') || typeof c.requerida_si_activa !== 'boolean')
        fail('CONFIGURACION_INVALIDA', 'Dependencia incompleta.', q);
      tests.set(q.id, comparison(c.depende_de, [c.valor_activador]));
    }
  }
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) fail('CONFIGURACION_INVALIDA', 'Ciclo condicional inválido.');
    if (done.has(id)) return;
    visiting.add(id);
    for (const ref of edges.get(id) ?? []) visit(ref);
    visiting.delete(id);
    done.add(id);
  }
  for (const q of form.preguntas) visit(q.id);
  return {
    tests,
    active(answers: Map<string, FormAnswer>) {
      const memo = new Map<string, boolean>();
      const active = (id: string): boolean => {
        if (memo.has(id)) return memo.get(id)!;
        const result = tests.get(id)?.(answers, active) ?? true;
        memo.set(id, result);
        return result;
      };
      return active;
    },
  };
}
export function validateFormDefinition(form: FormEdition): void {
  compile(form);
}
export function activeQuestionIds(form: FormEdition, answers: FormAnswer[]): Set<string> {
  const active = compile(form).active(new Map(answers.map((a) => [a.pregunta_id, a])));
  return new Set(form.preguntas.filter((q) => active(q.id)).map((q) => q.id));
}
export function visibleAnswers(form: FormEdition, answers: FormAnswer[]): FormAnswer[] {
  const active = activeQuestionIds(form, answers);
  return answers.filter((answer) => active.has(answer.pregunta_id));
}
function checkValue(q: FormQuestion, value: unknown) {
  const c = questionConfiguration(q),
    options = (q.opciones ?? []).map((o) => o.codigo);
  if (q.tipo === 'booleano' && typeof value !== 'boolean')
    fail('TIPO_RESPUESTA_INVALIDO', 'Selecciona una respuesta booleana.', q);
  if (q.tipo === 'numerico') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      fail('TIPO_RESPUESTA_INVALIDO', 'Ingresa un número válido.', q);
    if (
      (typeof c.min_value === 'number' && value < c.min_value) ||
      (typeof c.max_value === 'number' && value > c.max_value)
    )
      fail('VALOR_FUERA_DE_RANGO', 'El número está fuera de los límites del cuestionario.', q);
  }
  if (q.tipo === 'texto_libre') {
    if (typeof value !== 'string')
      fail('TIPO_RESPUESTA_INVALIDO', 'Ingresa una respuesta de texto.', q);
    const max =
      q.codigo === 'P10' ? 500 : typeof c.max_length === 'number' ? c.max_length : undefined;
    if (max !== undefined && Array.from(value).length > max)
      fail('LONGITUD_EXCEDIDA', `El texto admite un máximo de ${max} caracteres.`, q);
  }
  if (
    ['opcion_unica', 'escala_likert'].includes(q.tipo) &&
    (typeof value !== 'string' || !options.includes(value))
  )
    fail('OPCION_INVALIDA', 'Selecciona una opción de esta pregunta.', q);
  if (q.tipo === 'opcion_multiple') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !options.includes(v)))
      fail('OPCION_INVALIDA', 'La selección contiene una opción ajena a la pregunta.', q);
    const exclusive = c.opciones_exclusivas;
    if (Array.isArray(exclusive) && value.some((v) => exclusive.includes(v)) && value.length !== 1)
      fail(
        'OPCIONES_EXCLUSIVAS_INCOMPATIBLES',
        'La opción exclusiva debe seleccionarse sola. Desmarca las opciones incompatibles.',
        q,
      );
    if (new Set(value).size !== value.length)
      fail('OPCION_INVALIDA', 'La selección contiene opciones repetidas.', q);
  }
}
export function answerErrors(form: FormEdition, answers: FormAnswer[]): FormRuleError[] {
  const compiled = compile(form),
    byId = new Map(answers.map((a) => [a.pregunta_id, a]));
  if (byId.size !== answers.length)
    throw new FormRuleError(
      'PREGUNTA_DUPLICADA',
      'Hay preguntas repetidas.',
      undefined,
      'PREGUNTA_DUPLICADA',
    );
  const ids = new Set(form.preguntas.map((q) => q.id));
  if (answers.some((a) => !ids.has(a.pregunta_id)))
    throw new FormRuleError(
      'PREGUNTA_NO_PERTENECE',
      'La pregunta no pertenece a esta edición.',
      undefined,
      'PREGUNTA_NO_PERTENECE',
    );
  const active = compiled.active(byId),
    errors: FormRuleError[] = [];
  for (const q of form.preguntas) {
    const answer = byId.get(q.id),
      c = questionConfiguration(q);
    try {
      if (!active(q.id)) {
        if (answer)
          throw new FormRuleError(
            'PREGUNTA_NO_APLICABLE',
            'La pregunta oculta debe omitirse, incluso si su respuesta es nula.',
            q,
            'PREGUNTA_NO_APLICABLE',
          );
        continue;
      }
      const required = compiled.tests.has(q.id)
        ? c.requerida_si_activa === true
        : q.requerida !== false;
      const missing =
        !answer ||
        answer.valor === null ||
        answer.valor === undefined ||
        (typeof answer.valor === 'string' && !answer.valor.trim()) ||
        (Array.isArray(answer.valor) && answer.valor.length === 0);
      if (required && missing)
        fail(
          answer ? 'PREGUNTA_REQUERIDA_VACIA' : 'PREGUNTA_REQUERIDA_FALTANTE',
          'Falta una respuesta obligatoria.',
          q,
        );
      if (answer && answer.valor !== null && answer.valor !== undefined)
        checkValue(q, answer.valor);
    } catch (error) {
      if (error instanceof FormRuleError) errors.push(error);
      else throw error;
    }
  }
  return errors;
}
export function validateFormAnswers(form: FormEdition, answers: FormAnswer[]) {
  const errors = answerErrors(form, answers);
  if (errors.length) throw errors[0];
  const byId = new Map(answers.map((a) => [a.pregunta_id, a]));
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
