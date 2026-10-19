import {
  type FormAnswerValue,
  type FormCondition,
  type MedicalFormBundleItem,
  type QuestionConfiguration,
  CondicionInvalidaError,
  DefinicionIncompatibleError,
  TipoPreguntaNoSoportadoError,
  SUPPORTED_QUESTION_TYPES,
} from '../../data/local/forms/form-types';

/**
 * Evalúa una condición declarativa de forma pura sobre un conjunto de respuestas.
 * Si una respuesta está ausente, vacía o es inválida, la condición evalúa a false (falla segura).
 */
export function evaluateCondition(
  condition: FormCondition,
  answers: Record<string, FormAnswerValue>,
): boolean {
  if (!condition || typeof condition !== 'object') {
    return false;
  }

  switch (condition.op) {
    case 'eq': {
      const answer = answers[condition.questionId];
      if (answer === undefined || answer === null || answer === '') {
        return false;
      }
      return String(answer) === String(condition.value);
    }

    case 'in': {
      const answer = answers[condition.questionId];
      if (answer === undefined || answer === null || answer === '') {
        return false;
      }
      if (!Array.isArray(condition.values) || condition.values.length === 0) {
        return false;
      }
      if (Array.isArray(answer)) {
        return answer.some((val) => condition.values.includes(String(val)));
      }
      return condition.values.includes(String(answer));
    }

    case 'all': {
      if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
        return false;
      }
      return condition.conditions.every((subCondition) => evaluateCondition(subCondition, answers));
    }

    default:
      return false;
  }
}

export type QuestionWithConfig = {
  preguntaId?: string;
  pregunta_id?: string;
  configuracion?: QuestionConfiguration;
  configuracion_json?: string | null;
};

/**
 * Calcula el conjunto de IDs de preguntas actualmente visibles respetando el orden
 * de presentación y resolviendo de forma estricta las dependencias encadenadas:
 * si la pregunta A oculta a la pregunta B, las respuestas previas de B quedan
 * excluidas de la evaluación y no pueden mantener visible a una pregunta C.
 */
export function computeVisibleQuestions(
  questions: readonly QuestionWithConfig[],
  answers: Record<string, FormAnswerValue>,
): Set<string> {
  const visibleQuestionIds = new Set<string>();

  for (const q of questions) {
    const questionId = q.preguntaId ?? q.pregunta_id;
    if (!questionId) continue;

    let config: QuestionConfiguration | undefined = q.configuracion;
    if (!config && q.configuracion_json) {
      try {
        config = JSON.parse(q.configuracion_json);
      } catch {
        config = undefined;
      }
    }

    const condition = config?.visibleWhen;
    if (!condition) {
      visibleQuestionIds.add(questionId);
      continue;
    }

    // Filtrar respuestas: sólo se suministran aquellas pertenecientes a preguntas
    // que ya han sido confirmadas como visibles en el estado actual.
    const activeAnswers: Record<string, FormAnswerValue> = {};
    for (const key of Object.keys(answers)) {
      if (visibleQuestionIds.has(key)) {
        activeAnswers[key] = answers[key];
      }
    }

    if (evaluateCondition(condition, activeAnswers)) {
      visibleQuestionIds.add(questionId);
    }
  }

  return visibleQuestionIds;
}

function checkConditionTree(
  condition: FormCondition,
  currentQuestionId: string,
  currentIndex: number,
  questionIndexMap: Map<string, number>,
  questionOptionsMap: Map<string, Set<string>>,
  depth: number,
): void {
  if (depth > 5) {
    throw new DefinicionIncompatibleError(
      `La condición de la pregunta '${currentQuestionId}' supera la profundidad máxima permitida de 5 niveles.`,
    );
  }

  if (!condition || typeof condition !== 'object') {
    throw new CondicionInvalidaError(
      `Estructura de condición inválida en la pregunta '${currentQuestionId}'.`,
    );
  }

  if (condition.op === 'eq' || condition.op === 'in') {
    const refId = condition.questionId;
    if (!refId) {
      throw new CondicionInvalidaError(
        `La condición en la pregunta '${currentQuestionId}' no especifica 'questionId'.`,
      );
    }

    const refIndex = questionIndexMap.get(refId);
    if (refIndex === undefined) {
      throw new DefinicionIncompatibleError(
        `La pregunta '${currentQuestionId}' hace referencia a una pregunta desconocida '${refId}'.`,
      );
    }

    // Rechazo de autoreferencias y referencias hacia adelante en el orden de presentación
    if (refIndex >= currentIndex) {
      throw new DefinicionIncompatibleError(
        `La condición de la pregunta '${currentQuestionId}' hace referencia a una pregunta posterior o a sí misma ('${refId}') en el orden de presentación.`,
      );
    }

    // Validar valores contra las opciones disponibles si están tipadas
    const validOptions = questionOptionsMap.get(refId);
    if (validOptions && validOptions.size > 0) {
      if (condition.op === 'eq') {
        if (!validOptions.has(condition.value)) {
          throw new DefinicionIncompatibleError(
            `El valor '${condition.value}' en la condición de '${currentQuestionId}' no existe en las opciones de '${refId}'.`,
          );
        }
      } else if (condition.op === 'in') {
        if (!Array.isArray(condition.values) || condition.values.length === 0) {
          throw new CondicionInvalidaError(
            `El operador 'in' en la pregunta '${currentQuestionId}' requiere una lista no vacía de valores.`,
          );
        }
        for (const val of condition.values) {
          if (!validOptions.has(val)) {
            throw new DefinicionIncompatibleError(
              `El valor '${val}' en la condición de '${currentQuestionId}' no existe en las opciones de '${refId}'.`,
            );
          }
        }
      }
    }
  } else if (condition.op === 'all') {
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
      throw new CondicionInvalidaError(
        `El operador 'all' en la pregunta '${currentQuestionId}' requiere una lista no vacía de subcondiciones.`,
      );
    }
    for (const sub of condition.conditions) {
      checkConditionTree(
        sub,
        currentQuestionId,
        currentIndex,
        questionIndexMap,
        questionOptionsMap,
        depth + 1,
      );
    }
  } else {
    throw new DefinicionIncompatibleError(
      `Operador de condición no soportado '${(condition as { op: string }).op}' en la pregunta '${currentQuestionId}'.`,
    );
  }
}

/**
 * Valida la integridad estructural de una definición de formulario antes de persistirla:
 * - Unicidad de IDs de preguntas.
 * - Pertinencia y unicidad de secciones si están definidas.
 * - Ausencia de referencias hacia adelante, autoreferencias o ciclos.
 * - Profundidad de árbol <= 5.
 * - Tipos de preguntas soportados.
 * - Límites de longitud positivos en maxLength.
 */
export function validateConditionIntegrity(formItem: MedicalFormBundleItem): void {
  const questions = formItem.preguntas ?? [];
  const questionIndexMap = new Map<string, number>();
  const questionOptionsMap = new Map<string, Set<string>>();
  const definedSections = new Set<string>();

  if (formItem.configuracion?.secciones) {
    for (const sec of formItem.configuracion.secciones) {
      if (definedSections.has(sec.id)) {
        throw new DefinicionIncompatibleError(
          `Identificador de sección duplicado '${sec.id}' en el formulario '${formItem.formularioId}'.`,
        );
      }
      definedSections.add(sec.id);
    }
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (questionIndexMap.has(q.preguntaId)) {
      throw new DefinicionIncompatibleError(
        `ID de pregunta duplicado '${q.preguntaId}' en el formulario '${formItem.formularioId}'.`,
      );
    }
    questionIndexMap.set(q.preguntaId, i);

    if (!SUPPORTED_QUESTION_TYPES.includes(q.tipo as (typeof SUPPORTED_QUESTION_TYPES)[number])) {
      throw new TipoPreguntaNoSoportadoError(
        `Tipo de pregunta no soportado '${q.tipo}' en la pregunta '${q.preguntaId}'.`,
      );
    }

    const options = q.configuracion?.opciones;
    if (Array.isArray(options)) {
      const optionSet = new Set<string>();
      for (const opt of options) {
        if (optionSet.has(opt.valor)) {
          throw new DefinicionIncompatibleError(
            `Opción duplicada '${opt.valor}' en la pregunta '${q.preguntaId}'.`,
          );
        }
        optionSet.add(opt.valor);
      }
      questionOptionsMap.set(q.preguntaId, optionSet);
    }

    if (q.configuracion?.sectionId && definedSections.size > 0) {
      if (!definedSections.has(q.configuracion.sectionId)) {
        throw new DefinicionIncompatibleError(
          `La pregunta '${q.preguntaId}' referencia una sección inexistente '${q.configuracion.sectionId}'.`,
        );
      }
    }

    if (q.configuracion?.maxLength !== undefined) {
      if (!Number.isInteger(q.configuracion.maxLength) || q.configuracion.maxLength <= 0) {
        throw new DefinicionIncompatibleError(
          `El campo maxLength en la pregunta '${q.preguntaId}' debe ser un entero positivo.`,
        );
      }
    }
  }

  // Segunda pasada: validar árbol de condiciones contra mapa indexado
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const condition = q.configuracion?.visibleWhen;
    if (condition) {
      checkConditionTree(condition, q.preguntaId, i, questionIndexMap, questionOptionsMap, 1);
    }
  }
}
