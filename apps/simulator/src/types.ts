export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObjectValue = Record<string, unknown>;
export type DemoPatient = 'A' | 'B';

export const PATIENTS = {
  A: '964d32f1-6941-579f-9f08-b60342194da9',
  B: '2dcb04f2-a2ad-5ea4-b711-9acd7e570002',
} as const;

export const SCENARIOS = [
  'NORMAL',
  'ACK_SIGNOS_PERDIDO',
  'ACK_EPRO_PERDIDO',
  'SESION_EXPIRADA',
  'AUTORIZACION_DENEGADA',
  'TERMINOS_NUEVOS',
  'EDUCACION_RETIRADA',
  'IA_NO_DISPONIBLE',
  'IA_URGENCIA',
  'EDICION_CONDICIONAL',
  'EXCLUSIVIDAD_ACTIVA',
  'SERVICIO_NO_DISPONIBLE',
] as const;
export type Scenario = (typeof SCENARIOS)[number];
export interface ScenarioState {
  paciente_id: string;
  escenario: Scenario;
  aplicado_en: Date;
  generation: string;
  session_epoch: string;
  ack_signos_usado: boolean;
  ack_epro_usado: boolean;
}
export interface Principal {
  id: string;
  demo: DemoPatient;
  generation: string;
}
export interface Question {
  id: string;
  codigo: string;
  titulo: string;
  texto?: string | null;
  tipo: string;
  requerida?: boolean;
  orden: number;
  opciones?: { codigo: string; etiqueta: string; orden?: number }[];
  configuracion?: ObjectValue;
}
export interface FormDefinition {
  id: string;
  codigo: string;
  titulo: string;
  descripcion?: string | null;
  tratamiento: string;
  version: number;
  activo: boolean;
  version_condiciones: number;
  preguntas: Question[];
  fecha_creacion: string;
}
export interface AnswerInput {
  pregunta_id: string;
  valor: unknown;
  valor_texto?: string | null;
}
export interface EproInput {
  id: string;
  fecha_respuesta: string;
  respuestas: AnswerInput[];
  comentario?: string | null;
}
export interface SignsInput {
  id: string;
  fecha_registro: string;
  presion_arterial_sistolica?: number | null;
  presion_arterial_diastolica?: number | null;
  pulso?: number | null;
  temperatura?: number | null;
  saturacion_oxigeno?: number | null;
}
