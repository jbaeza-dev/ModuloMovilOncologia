/**
 * Tipos de demostración técnica para cuestionarios clínicos asignados.
 *
 * NOTA ARQUITECTÓNICA:
 * Esta definición representa un modelo provisional de demostración local.
 * No constituye el contrato central definitivo de OpenAPI, el cual será
 * consensuado e implementado en una fase posterior.
 */

export type MedicalFormQuestionType = 'single_choice' | 'multiple_choice' | 'scale_0_10' | 'text';

export type MedicalFormChoice = {
  valor: string;
  etiqueta: string;
};

export type MedicalFormQuestion = {
  id: string;
  pregunta: string;
  descripcion?: string;
  tipo: MedicalFormQuestionType;
  opciones?: MedicalFormChoice[];
  minEtiqueta?: string;
  maxEtiqueta?: string;
  requerida?: boolean;
};

export type MedicalFormDefinition = {
  id: string;
  titulo: string;
  descripcion: string;
  version: string;
  duracionEstimadaMin: number;
  preguntas: MedicalFormQuestion[];
};

export type FormAnswerValue = string | number | string[];

export type MedicalFormDraft = {
  formularioId: string;
  version: string;
  pacienteId: string;
  respuestas: Record<string, FormAnswerValue>;
  completado: boolean;
  guardadoEn: string;
};
