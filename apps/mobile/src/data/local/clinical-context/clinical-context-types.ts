export type ClinicalFileRecord = {
  ficha_id: string;
  paciente_id: string;
  obtenido_en: string;
};

export type MedicalProfessionalRecord = {
  id: string;
  nombre: string;
  especialidad: string;
  email: string | null;
  obtenido_en: string;
};

export type PatientClinicalLinkRecord = {
  id: string;
  paciente_id: string;
  profesional_id: string;
  estado_conocido: 'activo' | 'inactivo' | 'revocado';
  fecha_vinculacion: string;
  codigo_origen: string | null;
  obtenido_en: string;
};

export type ActiveMedicationRecord = {
  id: string;
  paciente_id: string;
  ficha_id: string | null;
  nombre: string;
  dosis: string;
  frecuencia: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado_activo: number;
  obtenido_en: string;
};

export type AssignedProfessional = {
  id: string;
  nombre: string;
  especialidad: string;
  email: string | null;
  fecha_vinculacion: string;
  estado_vinculo: 'activo' | 'inactivo' | 'revocado';
  obtenido_en: string;
};

export type ClinicalContextBundle = {
  fichas?: Array<{
    fichaId: string;
    pacienteId: string;
    obtenidoEn?: string;
  }>;
  profesionales?: Array<{
    id: string;
    nombre: string;
    especialidad: string;
    email?: string | null;
    obtenidoEn?: string;
  }>;
  vinculos?: Array<{
    id: string;
    pacienteId: string;
    profesionalId: string;
    estadoConocido: 'activo' | 'inactivo' | 'revocado';
    fechaVinculacion: string;
    codigoOrigen?: string | null;
    obtenidoEn?: string;
  }>;
  medicamentos?: Array<{
    id: string;
    pacienteId: string;
    fichaId?: string | null;
    nombre: string;
    dosis: string;
    frecuencia: string;
    fechaInicio?: string | null;
    fechaFin?: string | null;
    estadoActivo?: number | boolean;
    obtenidoEn?: string;
  }>;
};

export class ConflictoIdentidadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictoIdentidadError';
  }
}
