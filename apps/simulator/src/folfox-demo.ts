import { randomUUID } from 'node:crypto';
import type { ObjectValue } from './types.js';

export const FOLFOX_MEDICATIONS_SPEC = [
  {
    nombre: 'Oxaliplatino',
    dosis: '85 mg/m² en infusión IV de 2 horas',
    frecuencia: 'Día 1 de cada ciclo cada 14 días',
    motivo:
      'Componente del esquema mFOLFOX6: agente alquilante de platino en infusión intravenosa.',
  },
  {
    nombre: 'Ácido folínico (leucovorina)',
    dosis: '400 mg/m² en infusión IV de 2 horas',
    frecuencia: 'Día 1 de cada ciclo cada 14 días',
    motivo:
      'Componente del esquema mFOLFOX6: modulador bioquímico para potenciar el fluorouracilo.',
  },
  {
    nombre: 'Fluorouracilo (5-FU)',
    dosis: '400 mg/m² en bolo IV y 2400 mg/m² en infusión continua de 46 horas',
    frecuencia: 'Día 1 (bolo e inicio de infusión continua por 46 h) cada 14 días',
    motivo:
      'Componente del esquema mFOLFOX6: antimetabolito fluoropirimidínico en bolo e infusión continua.',
  },
] as const;

export function folfoxDemo(clinical: ObjectValue, treatment: ObjectValue) {
  return {
    clinical: {
      ...clinical,
      medicamentos: FOLFOX_MEDICATIONS_SPEC.map((med) => ({
        id: randomUUID(),
        medicamento_id: randomUUID(),
        nombre: med.nombre,
        dosis: med.dosis,
        frecuencia: med.frecuencia,
        motivo: med.motivo,
        activo: true,
        fecha_inicio: null,
        fecha_termino: null,
      })),
    },
    treatment: {
      ...treatment,
      codigo_icd10: 'C18.9',
      fase: 'Adyuvancia',
      intencion: 'curativa',
      parametros: {
        ...(treatment.parametros as ObjectValue),
        esquema: 'mFOLFOX6 (oxaliplatino, ácido folínico y fluorouracilo)',
        numero_ciclos: 12,
        observaciones:
          'Pauta clínica adyuvante mFOLFOX6 en ciclos cada 14 días hasta completar 12 ciclos (oxaliplatino 85 mg/m² IV día 1, ácido folínico 400 mg/m² IV día 1 y fluorouracilo 400 mg/m² en bolo IV seguido de 2400 mg/m² en infusión continua por 46 horas). Protocolo de referencia clínica eviQ 637.',
      },
    },
  };
}
