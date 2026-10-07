import type { MedicalFormDefinition } from './medical-form-types';
import { SAMPLE_MEDICAL_FORMS } from './sample-medical-forms';

const DEMO_PATIENT_B = '22222222-2222-4222-8222-222222222222';

export interface MedicalFormsService {
  getAssignedForms(patientId: string): MedicalFormDefinition[];
  getForm(patientId: string, formId: string, version?: string): MedicalFormDefinition | null;
}

/**
 * Servicio de demostración técnica que provee asignaciones de cuestionarios médicos de muestra.
 * Mantiene pacientes neutros y demuestra asignaciones diferenciadas:
 * - Paciente A de Prueba: 2 cuestionarios de muestra asignados (QLQ-C30 y ESAS).
 * - Paciente B de Prueba: 1 cuestionario de muestra asignado (ESAS).
 */
export class DemoMedicalFormsService implements MedicalFormsService {
  getAssignedForms(patientId: string): MedicalFormDefinition[] {
    if (patientId === DEMO_PATIENT_B) {
      // Paciente B solo tiene asignada la muestra ESAS
      return SAMPLE_MEDICAL_FORMS.filter((f) => f.id === 'form-esas-muestra');
    }
    // Paciente A (y por defecto en demo) tiene asignadas ambas muestras
    return SAMPLE_MEDICAL_FORMS;
  }

  getForm(patientId: string, formId: string, version?: string): MedicalFormDefinition | null {
    const assigned = this.getAssignedForms(patientId);
    return assigned.find((f) => f.id === formId && (!version || f.version === version)) ?? null;
  }
}

export const medicalFormsService = new DemoMedicalFormsService();
