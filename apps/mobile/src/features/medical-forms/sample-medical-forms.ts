import type { MedicalFormDefinition } from './medical-form-types';

export const SAMPLE_MEDICAL_FORMS: MedicalFormDefinition[] = [
  {
    id: 'form-qlq30-muestra',
    titulo: 'Calidad de Vida en Tratamiento (Muestra QLQ-C30)',
    descripcion:
      'Cuestionario clínico de muestra para valorar el impacto del ciclo de quimioterapia en tu bienestar diario.',
    version: '1.0',
    duracionEstimadaMin: 3,
    preguntas: [
      {
        id: 'q1',
        pregunta:
          '¿Durante el día de hoy has tenido dificultades para realizar tus actividades cotidianas?',
        tipo: 'single_choice',
        requerida: true,
        opciones: [
          { valor: 'nada', etiqueta: 'Nada' },
          { valor: 'un_poco', etiqueta: 'Un poco' },
          { valor: 'bastante', etiqueta: 'Bastante' },
          { valor: 'mucho', etiqueta: 'Mucho' },
        ],
      },
      {
        id: 'q2',
        pregunta: '¿Has sentido cansancio o falta de energía persistente?',
        tipo: 'single_choice',
        requerida: true,
        opciones: [
          { valor: 'nada', etiqueta: 'Nada' },
          { valor: 'un_poco', etiqueta: 'Un poco' },
          { valor: 'bastante', etiqueta: 'Bastante' },
          { valor: 'mucho', etiqueta: 'Mucho' },
        ],
      },
      {
        id: 'q3',
        pregunta: '¿Has presentado náuseas o disminución del apetito?',
        tipo: 'single_choice',
        requerida: true,
        opciones: [
          { valor: 'nada', etiqueta: 'Nada' },
          { valor: 'un_poco', etiqueta: 'Un poco' },
          { valor: 'bastante', etiqueta: 'Bastante' },
          { valor: 'mucho', etiqueta: 'Mucho' },
        ],
      },
      {
        id: 'q4',
        pregunta: '¿Cómo calificarías tu calidad de vida global durante la última jornada?',
        tipo: 'scale_0_10',
        minEtiqueta: '0 = Muy mala',
        maxEtiqueta: '10 = Excelente',
        requerida: true,
      },
      {
        id: 'q5',
        pregunta: 'Comentarios adicionales sobre tu estado actual:',
        tipo: 'text',
        descripcion:
          'Puedes detallar sensaciones específicas que desees consultar en tu próxima visita.',
        requerida: false,
      },
    ],
  },
  {
    id: 'form-esas-muestra',
    titulo: 'Evaluación de Síntomas de Edmonton (ESAS de muestra)',
    descripcion:
      'Escala de evaluación rápida para cuantificar la intensidad de molestias comunes asociadas al tratamiento.',
    version: '1.0',
    duracionEstimadaMin: 2,
    preguntas: [
      {
        id: 'esas_dolor',
        pregunta: 'Nivel de dolor percibido:',
        tipo: 'scale_0_10',
        minEtiqueta: '0 = Sin dolor',
        maxEtiqueta: '10 = Máximo dolor',
        requerida: true,
      },
      {
        id: 'esas_fatiga',
        pregunta: 'Nivel de cansancio o fatiga:',
        tipo: 'scale_0_10',
        minEtiqueta: '0 = Sin cansancio',
        maxEtiqueta: '10 = Cansancio extremo',
        requerida: true,
      },
      {
        id: 'esas_nauseas',
        pregunta: 'Nivel de malestar estomacal o náuseas:',
        tipo: 'scale_0_10',
        minEtiqueta: '0 = Sin náuseas',
        maxEtiqueta: '10 = Náuseas intensas',
        requerida: true,
      },
      {
        id: 'esas_sintomas_secundarios',
        pregunta: 'Molestias acompañantes presentes:',
        tipo: 'multiple_choice',
        requerida: false,
        opciones: [
          { valor: 'boca_seca', etiqueta: 'Boca seca o mucositis' },
          { valor: 'dificultad_dormir', etiqueta: 'Dificultad para conciliar el sueño' },
          { valor: 'sensibilidad_frio', etiqueta: 'Sensibilidad al frío o disestesias' },
          { valor: 'mareos', etiqueta: 'Mareos o sensación de inestabilidad' },
          { valor: 'ninguna', etiqueta: 'Ninguna molestia adicional' },
        ],
      },
      {
        id: 'esas_notas',
        pregunta: 'Observaciones para el registro clínico local:',
        tipo: 'text',
        requerida: false,
      },
    ],
  },
];
