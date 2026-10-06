import type {
  FormAnswerValue,
  MedicalFormDefinition,
  MedicalFormQuestion,
} from './medical-form-types';

export type AnswerValidationResult = {
  isValid: boolean;
  errors: Record<string, string>;
};

/**
 * Valida funcionalmente las respuestas ingresadas a un cuestionario médico de muestra:
 * - Valida campos requeridos (no vacíos ni ausentes).
 * - Valida tipos y coherencia de opciones en todas las respuestas presentes (incluso si la pregunta es opcional).
 * - Aplica la regla de opción excluyente en preguntas de selección múltiple (ej. 'ninguna' no puede combinarse con otras).
 */
export function validateFormAnswers(
  form: MedicalFormDefinition,
  answers: Record<string, FormAnswerValue>,
): AnswerValidationResult {
  const errors: Record<string, string> = {};

  for (const question of form.preguntas) {
    const value = answers[question.id];
    const isPresent = value !== undefined && value !== null;

    // 1. Validación de obligatoriedad
    if (question.requerida) {
      if (!isPresent) {
        errors[question.id] = 'Esta pregunta es obligatoria.';
        continue;
      }
      if (typeof value === 'string' && value.trim().length === 0) {
        errors[question.id] = 'Esta pregunta es obligatoria.';
        continue;
      }
      if (Array.isArray(value) && value.length === 0) {
        errors[question.id] = 'Debes seleccionar al menos una opción.';
        continue;
      }
    }

    // Si no está presente y es opcional, pasa la validación
    if (!isPresent) {
      continue;
    }

    // 2. Validación por tipo para cualquier respuesta presente
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

function validateQuestionValue(
  question: MedicalFormQuestion,
  value: FormAnswerValue,
): string | null {
  switch (question.tipo) {
    case 'single_choice': {
      if (typeof value !== 'string') {
        return 'El valor debe ser una opción válida.';
      }
      const validOptions = question.opciones?.map((o) => o.valor) ?? [];
      if (!validOptions.includes(value)) {
        return 'La opción seleccionada no es válida.';
      }
      return null;
    }

    case 'multiple_choice': {
      if (!Array.isArray(value)) {
        return 'El valor debe ser una lista de opciones.';
      }
      const validOptions = question.opciones?.map((o) => o.valor) ?? [];
      for (const item of value) {
        if (typeof item !== 'string' || !validOptions.includes(item)) {
          return `La opción seleccionada no es válida.`;
        }
      }
      // Regla de opción excluyente para 'ninguna'
      if (value.includes('ninguna') && value.length > 1) {
        return 'La opción «Ninguna molestia adicional» no puede combinarse con otras molestias.';
      }
      return null;
    }

    case 'scale_0_10': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return 'Debes seleccionar un valor entero en la escala.';
      }
      if (value < 0 || value > 10) {
        return 'El valor debe encontrarse entre 0 y 10.';
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
