import type { FormAnswerValue, FormQuestionRecord, MedicalFormQuestionType } from './form-types';

export type ValidatableQuestion = {
  id: string;
  texto?: string;
  tipo: MedicalFormQuestionType;
  requerida?: boolean;
  opciones?: Array<{ valor: string; etiqueta: string; esExcluyente?: boolean }>;
  min?: number;
  max?: number;
  minEtiqueta?: string;
  maxEtiqueta?: string;
};

export type ValidatableForm = {
  id: string;
  titulo?: string;
  preguntas: ValidatableQuestion[];
};

export type AnswerValidationResult = {
  isValid: boolean;
  errors: Record<string, string>;
};

/**
 * Valida un valor individual según el tipo y la configuración de la pregunta.
 */
export function validateQuestionValue(
  question: ValidatableQuestion,
  value: FormAnswerValue,
): string | null {
  switch (question.tipo) {
    case 'single_choice': {
      if (typeof value !== 'string') {
        return 'El valor debe ser una opción válida.';
      }
      if (question.opciones && question.opciones.length > 0) {
        const validValues = question.opciones.map((o) => o.valor);
        if (!validValues.includes(value)) {
          return 'La opción seleccionada no es válida.';
        }
      }
      return null;
    }

    case 'multiple_choice': {
      if (!Array.isArray(value)) {
        return 'El valor debe ser una lista de opciones.';
      }
      const validOptions = question.opciones ?? [];
      const validValues = validOptions.map((o) => o.valor);

      for (const item of value) {
        if (typeof item !== 'string' || (validValues.length > 0 && !validValues.includes(item))) {
          return 'La opción seleccionada no es válida.';
        }
      }

      // Regla de opción excluyente basada en la configuración médica (esExcluyente)
      const exclusiveOptions = validOptions.filter((o) => o.esExcluyente);
      for (const excl of exclusiveOptions) {
        if (value.includes(excl.valor) && value.length > 1) {
          return `La opción «${excl.etiqueta}» no puede combinarse con otras opciones.`;
        }
      }

      // Compatibilidad si la configuración no marcó esExcluyente pero la opción es 'ninguna'
      if (exclusiveOptions.length === 0 && value.includes('ninguna') && value.length > 1) {
        return 'La opción «Ninguna» no puede combinarse con otras opciones.';
      }

      return null;
    }

    case 'scale_0_10': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return 'Debes seleccionar un valor entero en la escala.';
      }
      const min = question.min ?? 0;
      const max = question.max ?? 10;
      if (value < min || value > max) {
        return `El valor debe encontrarse entre ${min} y ${max}.`;
      }
      return null;
    }

    case 'text': {
      if (typeof value !== 'string') {
        return 'El texto ingresado no es válido.';
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Valida funcionalmente un conjunto de respuestas frente a un formulario clínico.
 * - Rechaza cualquier clave ajena a la definición.
 * - Valida tipos y coherencia de cada respuesta presente (incluso en preguntas opcionales).
 * - Exige respuestas obligatorias.
 */
export function validateFormAnswers(
  form: ValidatableForm,
  answers: Record<string, FormAnswerValue>,
): AnswerValidationResult {
  const errors: Record<string, string> = {};
  const validQuestionMap = new Map<string, ValidatableQuestion>();
  for (const q of form.preguntas) {
    validQuestionMap.set(q.id, q);
  }

  // 1. Rechazar claves ajenas a la definición del formulario
  for (const key of Object.keys(answers)) {
    if (!validQuestionMap.has(key)) {
      errors[key] = `La clave '${key}' no pertenece a la definición de este cuestionario.`;
    }
  }

  // 2. Validar cada pregunta de la definición
  for (const question of form.preguntas) {
    const value = answers[question.id];
    const isPresent = value !== undefined && value !== null;

    // Determinar si representa ausencia para su tipo específico
    const isBlankText = typeof value === 'string' && value.trim().length === 0;
    const isEmptyArray = Array.isArray(value) && value.length === 0;

    if (question.requerida) {
      if (!isPresent) {
        errors[question.id] = 'Esta pregunta es obligatoria.';
        continue;
      }
      if (isBlankText && question.tipo === 'text') {
        errors[question.id] = 'Esta pregunta es obligatoria.';
        continue;
      }
      if (isEmptyArray && question.tipo === 'multiple_choice') {
        errors[question.id] = 'Debes seleccionar al menos una opción.';
        continue;
      }
    } else {
      // Si es opcional y no está presente
      if (!isPresent) {
        continue;
      }
      // Si es opcional y es texto en blanco o array vacío
      if (question.tipo === 'text' && isBlankText) {
        continue;
      }
      if (question.tipo === 'multiple_choice' && isEmptyArray) {
        continue;
      }
    }

    // 3. Validación de coherencia y tipos para cualquier respuesta presente
    const typeError = validateQuestionValue(question, value);
    if (typeError) {
      errors[question.id] = typeError;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Normaliza las respuestas antes de persistirlas, descartando respuestas opcionales vacías.
 */
export function normalizeFormAnswers(
  form: ValidatableForm,
  answers: Record<string, FormAnswerValue>,
): Record<string, FormAnswerValue> {
  const result: Record<string, FormAnswerValue> = {};
  const questionMap = new Map<string, ValidatableQuestion>();
  for (const q of form.preguntas) {
    questionMap.set(q.id, q);
  }

  for (const [key, value] of Object.entries(answers)) {
    const q = questionMap.get(key);
    if (!q) continue;

    if (value === undefined || value === null) continue;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0 && !q.requerida) continue;
      result[key] = q.tipo === 'text' ? trimmed : value;
    } else if (Array.isArray(value)) {
      if (value.length === 0 && !q.requerida) continue;
      result[key] = value;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convierte registros de `pregunta_cache` al formato validable y valida las respuestas.
 */
export function toValidatableQuestions(questions: FormQuestionRecord[]): ValidatableQuestion[] {
  return questions.map((q) => {
    let configuracion: {
      opciones?: Array<{ valor: string; etiqueta: string; esExcluyente?: boolean }>;
      min?: number;
      max?: number;
      minEtiqueta?: string;
      maxEtiqueta?: string;
    } | null = null;

    if (q.configuracion_json) {
      try {
        configuracion = JSON.parse(q.configuracion_json);
      } catch {
        configuracion = null;
      }
    }

    return {
      id: q.pregunta_id,
      texto: q.texto,
      tipo: q.tipo,
      requerida: q.requerida === 1,
      opciones: configuracion?.opciones,
      min: configuracion?.min,
      max: configuracion?.max,
      minEtiqueta: configuracion?.minEtiqueta,
      maxEtiqueta: configuracion?.maxEtiqueta,
    };
  });
}

/**
 * Convierte registros de `pregunta_cache` al formato validable y valida las respuestas.
 */
export function validateFormQuestionsRecords(
  questions: FormQuestionRecord[],
  answers: Record<string, FormAnswerValue>,
): AnswerValidationResult {
  return validateFormAnswers(
    {
      id: questions[0]?.formulario_id ?? '',
      preguntas: toValidatableQuestions(questions),
    },
    answers,
  );
}

/**
 * Normaliza respuestas a partir de registros de `pregunta_cache`.
 */
export function normalizeFormQuestionsRecords(
  questions: FormQuestionRecord[],
  answers: Record<string, FormAnswerValue>,
): Record<string, FormAnswerValue> {
  return normalizeFormAnswers(
    {
      id: questions[0]?.formulario_id ?? '',
      preguntas: toValidatableQuestions(questions),
    },
    answers,
  );
}

/**
 * Normaliza y compara dos conjuntos de respuestas para verificar igualdad estricta de contenido.
 */
export function areAnswersEqual(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const normalize = (obj: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const val = obj[key];
      if (Array.isArray(val)) {
        result[key] = [...val].sort();
      } else {
        result[key] = val;
      }
    }
    return result;
  };

  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
