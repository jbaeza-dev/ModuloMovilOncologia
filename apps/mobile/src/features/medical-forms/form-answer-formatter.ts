import type {
  FormAnswerValue,
  MedicalFormChoice,
  MedicalFormQuestionType,
  QuestionConfiguration,
} from '../../data/local/forms/form-types';

export interface FormAnswerFormatterOptions {
  tipo: MedicalFormQuestionType;
  obligatoria?: boolean | number;
  configuracion?: QuestionConfiguration & {
    min?: number;
    max?: number;
  };
  opciones?: MedicalFormChoice[];
}

export interface FormattedAnswerResult {
  text: string;
  items?: string[];
  scaleContext?: string;
  isUnanswered: boolean;
}

export const FALLBACK_UNKNOWN_OPTION_LABEL = 'Respuesta registrada; descripción no disponible';
export const UNANSWERED_REQUIRED_LABEL = 'Sin respuesta registrada';
export const UNANSWERED_OPTIONAL_LABEL = 'Sin respuesta (opcional)';

/**
 * Formatea de manera declarativa y legible las respuestas guardadas de un formulario médico,
 * respetando la versión histórica del cuestionario, los límites configurados y la obligatoriedad.
 *
 * Invariante clínico: solo presenta las etiquetas explícitamente suministradas en la definición,
 * sin inferir ni deducir categorías diagnósticas a partir de valores numéricos.
 */
export function formatFormAnswer(
  question: FormAnswerFormatterOptions,
  value: FormAnswerValue | null | undefined,
): FormattedAnswerResult {
  const isRequired = question.obligatoria === true || question.obligatoria === 1;

  // Comprobar ausencia de respuesta (el valor 0 es numéricamente válido y no es ausencia)
  const isValueEmpty =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0);

  if (isValueEmpty) {
    return {
      text: isRequired ? UNANSWERED_REQUIRED_LABEL : UNANSWERED_OPTIONAL_LABEL,
      isUnanswered: true,
    };
  }

  const availableOptions: MedicalFormChoice[] =
    question.configuracion?.opciones ?? question.opciones ?? [];

  switch (question.tipo) {
    case 'single_choice': {
      const stringVal = String(value);
      const match = availableOptions.find((opt) => opt.valor === stringVal);
      if (match) {
        return { text: match.etiqueta, isUnanswered: false };
      }
      return { text: FALLBACK_UNKNOWN_OPTION_LABEL, isUnanswered: false };
    }

    case 'multiple_choice': {
      const rawList = Array.isArray(value) ? value : [value];
      const validItems = rawList.filter(
        (v) => v !== null && v !== undefined && String(v).trim() !== '',
      );

      if (validItems.length === 0) {
        return {
          text: isRequired ? UNANSWERED_REQUIRED_LABEL : UNANSWERED_OPTIONAL_LABEL,
          isUnanswered: true,
        };
      }

      const items = validItems.map((item) => {
        const itemStr = String(item);
        const match = availableOptions.find((opt) => opt.valor === itemStr);
        return match ? match.etiqueta : FALLBACK_UNKNOWN_OPTION_LABEL;
      });

      return {
        text: items.join('\n'),
        items,
        isUnanswered: false,
      };
    }

    case 'scale_0_10': {
      const numVal = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(numVal)) {
        return { text: String(value).trim(), isUnanswered: false };
      }

      const min = typeof question.configuracion?.min === 'number' ? question.configuracion.min : 0;
      const max = typeof question.configuracion?.max === 'number' ? question.configuracion.max : 10;
      const baseText = `${numVal} de ${max}`;

      // Verificar si existe una etiqueta explícita para este número concreto en las opciones
      const discreteMatch = availableOptions.find((opt) => opt.valor === String(numVal));

      if (discreteMatch && discreteMatch.etiqueta) {
        return {
          text: `${baseText} (${discreteMatch.etiqueta})`,
          isUnanswered: false,
        };
      }

      // Si no hay etiqueta discreta pero hay etiquetas de extremos, construir el contexto explicativo
      const minLabel = question.configuracion?.minEtiqueta?.trim();
      const maxLabel = question.configuracion?.maxEtiqueta?.trim();
      let scaleContext: string | undefined;

      if (minLabel && maxLabel) {
        scaleContext = `${min}: ${minLabel} · ${max}: ${maxLabel}`;
      } else if (minLabel) {
        scaleContext = `${min}: ${minLabel}`;
      } else if (maxLabel) {
        scaleContext = `${max}: ${maxLabel}`;
      }

      return {
        text: baseText,
        scaleContext,
        isUnanswered: false,
      };
    }

    case 'text':
    default: {
      const trimmed = String(value).trim();
      if (trimmed === '') {
        return {
          text: isRequired ? UNANSWERED_REQUIRED_LABEL : UNANSWERED_OPTIONAL_LABEL,
          isUnanswered: true,
        };
      }
      return { text: trimmed, isUnanswered: false };
    }
  }
}
