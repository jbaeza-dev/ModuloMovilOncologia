import type {
  MedicalFormBundleItem,
  MedicalFormBundleQuestion,
} from '../../../data/local/forms/form-types';

/**
 * Segundo formulario de prueba desacoplado para verificar que el motor y la UI
 * no dependen de códigos P1–P10 ni de 11 secciones fijas.
 */
export const SAMPLE_DECOUPLED_FORM_ID = 'evaluacion-rapida-bienestar';
export const SAMPLE_DECOUPLED_FORM_VERSION = '1.0.0';

export const SAMPLE_DECOUPLED_FORM_SECCIONES = [
  { id: 'sec-animo', titulo: 'Estado de ánimo', orden: 0 },
  { id: 'sec-comentario', titulo: 'Comentario breve', orden: 1 },
] as const;

export const SAMPLE_DECOUPLED_FORM_PREGUNTAS: MedicalFormBundleQuestion[] = [
  {
    preguntaId: 'Q_ANIMO',
    texto: '¿Te has sentido con buen ánimo hoy?',
    tipo: 'single_choice',
    orden: 0,
    requerida: true,
    configuracion: {
      sectionId: 'sec-animo',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'Q_DETALLE_ANIMO',
    texto: '¿Qué actividad te ayudó a sentirte mejor?',
    tipo: 'single_choice',
    orden: 1,
    requerida: false,
    configuracion: {
      sectionId: 'sec-animo',
      visibleWhen: { op: 'eq', questionId: 'Q_ANIMO', value: 'si' },
      opciones: [
        { valor: 'descanso', etiqueta: 'Descansar o dormir una siesta' },
        { valor: 'familia', etiqueta: 'Conversar con familiares o amigos' },
        { valor: 'paseo', etiqueta: 'Caminar o tomar aire fresco' },
      ],
    },
  },
  {
    preguntaId: 'Q_COMENTARIO',
    texto: 'Escribe un comentario breve sobre tu jornada (máximo 200 caracteres):',
    tipo: 'text',
    orden: 2,
    requerida: false,
    configuracion: {
      sectionId: 'sec-comentario',
      maxLength: 200,
    },
  },
];

export const SAMPLE_DECOUPLED_BUNDLE_ITEM: MedicalFormBundleItem = {
  formularioId: SAMPLE_DECOUPLED_FORM_ID,
  version: SAMPLE_DECOUPLED_FORM_VERSION,
  titulo: 'Evaluación rápida de bienestar',
  descripcion: 'Cuestionario breve para verificar desacoplamiento del motor.',
  duracionEstimadaMin: 2,
  configuracion: {
    periodicidad: 'standalone',
    schemaVersion: 1,
    secciones: [...SAMPLE_DECOUPLED_FORM_SECCIONES],
  },
  preguntas: SAMPLE_DECOUPLED_FORM_PREGUNTAS,
};
