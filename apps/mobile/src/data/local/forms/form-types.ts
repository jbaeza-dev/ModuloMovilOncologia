export type MedicalFormQuestionType = 'single_choice' | 'multiple_choice' | 'scale_0_10' | 'text';

export const SUPPORTED_QUESTION_TYPES: readonly MedicalFormQuestionType[] = [
  'single_choice',
  'multiple_choice',
  'scale_0_10',
  'text',
] as const;

export type FormAnswerValue = string | number | string[];

export class VersionInmutableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionInmutableError';
  }
}

export class TipoPreguntaNoSoportadoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TipoPreguntaNoSoportadoError';
  }
}

export class ConflictoEntregaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictoEntregaError';
  }
}

export type FormDefinitionRecord = {
  formulario_id: string;
  version: string;
  titulo: string;
  descripcion: string;
  duracion_estimada_min: number;
  configuracion_json: string | null;
  retirado: number;
  obtenido_en: string;
};

export type FormQuestionRecord = {
  formulario_id: string;
  version: string;
  pregunta_id: string;
  texto: string;
  descripcion: string | null;
  tipo: MedicalFormQuestionType;
  orden: number;
  requerida: number;
  configuracion_json: string | null;
  retirado: number;
};

export type FormAssignmentRecord = {
  paciente_id: string;
  formulario_id: string;
  version: string;
  estado_conocido: 'activa' | 'retirada';
  asignacion_origen_id: string | null;
  obtenido_en: string;
};

export type FormDraftRecord = {
  paciente_id: string;
  formulario_id: string;
  version: string;
  entrega_id: string;
  respuestas_json: string;
  guardado_en: string;
  version_payload: number;
};

export type FormSubmissionRecord = {
  id: string;
  paciente_id: string;
  formulario_id: string;
  version: string;
  respuestas_json: string;
  fecha_confirmacion: string;
  creado_localmente_en: string;
};

export type FormLegacyImportRecord = {
  paciente_id: string;
  archivo_relativo: string;
  huella_sha256: string;
  huella_bak_sha256: string | null;
  destino_tipo: 'borrador' | 'respuesta' | 'invalido';
  destino_id: string | null;
  estado: 'importado' | 'limpieza_pendiente' | 'fallido' | 'revision_requerida';
  fecha_importacion: string;
  ultimo_error: string | null;
};

export type MedicalFormChoice = {
  valor: string;
  etiqueta: string;
  esExcluyente?: boolean;
};

export type MedicalFormBundleQuestion = {
  preguntaId: string;
  texto: string;
  descripcion?: string;
  tipo: string;
  orden: number;
  requerida?: boolean;
  configuracion?: {
    opciones?: MedicalFormChoice[];
    minEtiqueta?: string;
    maxEtiqueta?: string;
    [key: string]: unknown;
  };
};

export type MedicalFormBundleItem = {
  formularioId: string;
  version: string;
  titulo: string;
  descripcion: string;
  duracionEstimadaMin: number;
  configuracion?: Record<string, unknown>;
  preguntas: MedicalFormBundleQuestion[];
};

export type MedicalFormAssignmentItem = {
  pacienteId: string;
  formularioId: string;
  version: string;
  estado?: 'activa' | 'retirada';
  asignacionOrigenId?: string;
};

export type MedicalFormBundle = {
  formularios?: MedicalFormBundleItem[];
  asignaciones?: MedicalFormAssignmentItem[];
};
