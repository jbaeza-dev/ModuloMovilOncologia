import { randomUUID } from 'node:crypto';
import type { ObjectValue } from './types.js';

export function folfoxDemo(clinical: ObjectValue, treatment: ObjectValue) {
  const names = ['Oxaliplatino', 'Ácido folínico (leucovorina)', 'Fluorouracilo (5-FU)'];
  return {
    clinical: {
      ...clinical,
      medicamentos: names.map((nombre) => ({
        id: randomUUID(),
        medicamento_id: randomUUID(),
        nombre,
        dosis: 'Individualizada por el equipo de oncología',
        frecuencia: 'Administración por el equipo de oncología según ciclo',
        motivo: 'Componente del esquema mFOLFOX6. Ejemplo académico, sin indicación domiciliaria.',
        activo: false,
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
          'Referencia general: ciclos cada 14 días; fluorouracilo en infusión de 46 horas. Duración y dosis individualizadas por oncología. Caso académico, no es una prescripción. Fuente: eviQ, protocolo 637.',
      },
    },
  };
}
