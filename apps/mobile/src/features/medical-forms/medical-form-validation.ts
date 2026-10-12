import {
  type AnswerValidationResult,
  validateFormAnswers as baseValidateFormAnswers,
  validateQuestionValue as baseValidateQuestionValue,
  type ValidatableQuestion,
} from '../../data/local/forms/form-validation';
import type {
  FormAnswerValue,
  MedicalFormDefinition,
  MedicalFormQuestion,
} from './medical-form-types';

export type { AnswerValidationResult };

/**
 * Valida funcionalmente las respuestas ingresadas a un cuestionario médico de muestra,
 * delegando en el validador central del dominio clínico.
 */
export function validateFormAnswers(
  form: MedicalFormDefinition,
  answers: Record<string, FormAnswerValue>,
): AnswerValidationResult {
  const validatableQuestions: ValidatableQuestion[] = form.preguntas.map((q) => ({
    id: q.id,
    texto: q.pregunta,
    tipo: q.tipo,
    requerida: q.requerida,
    opciones: q.opciones,
    min: 0,
    max: 10,
    minEtiqueta: q.minEtiqueta,
    maxEtiqueta: q.maxEtiqueta,
  }));

  return baseValidateFormAnswers(
    {
      id: form.id,
      titulo: form.titulo,
      preguntas: validatableQuestions,
    },
    answers,
  );
}

export function validateQuestionValue(
  question: MedicalFormQuestion,
  value: FormAnswerValue,
): string | null {
  return baseValidateQuestionValue(
    {
      id: question.id,
      texto: question.pregunta,
      tipo: question.tipo,
      requerida: question.requerida,
      opciones: question.opciones,
      min: 0,
      max: 10,
      minEtiqueta: question.minEtiqueta,
      maxEtiqueta: question.maxEtiqueta,
    },
    value,
  );
}
