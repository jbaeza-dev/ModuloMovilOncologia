import type {
  MedicalFormBundleItem,
  MedicalFormBundleQuestion,
} from '../../../data/local/forms/form-types';

export {
  SEGUIMIENTO_DOMICILIARIO_V1_0_0_BUNDLE_ITEM,
  SEGUIMIENTO_DOMICILIARIO_V1_0_0_FORM_ID,
  SEGUIMIENTO_DOMICILIARIO_V1_0_0_PREGUNTAS,
  SEGUIMIENTO_DOMICILIARIO_V1_0_0_SECCIONES,
  SEGUIMIENTO_DOMICILIARIO_V1_0_0_VERSION,
} from './seguimiento-domiciliario-v1';

/**
 * Fixture del instrumento clínico suministrado (Cuestionario de Seguimiento Domiciliario ePRO v1.1.0).
 * Incorpora las 41 preguntas definidas en 11 módulos, con enunciados, alternativas y condiciones
 * 100% fieles al documento original de monitoreo domiciliario de pacientes en quimioterapia.
 *
 * AVISO ARQUITECTÓNICO:
 * Este instrumento constituye un caso de compatibilidad y prueba técnica demostrativa en modo demo.
 * No atribuye diagnóstico médico, clasificación automática de gravedad ni atención clínica en tiempo real.
 */
export const SEGUIMIENTO_DOMICILIARIO_FORM_ID = 'seguimiento-domiciliario';
export const SEGUIMIENTO_DOMICILIARIO_VERSION = '1.1.0';

export const SEGUIMIENTO_DOMICILIARIO_SECCIONES = [
  { id: 'sec-modulo-0', titulo: 'Contexto y dispositivos', orden: 0 },
  { id: 'sec-modulo-1', titulo: 'Fiebre e infección', orden: 1 },
  { id: 'sec-modulo-2', titulo: 'Náuseas y vómitos', orden: 2 },
  { id: 'sec-modulo-3', titulo: 'Tránsito intestinal', orden: 3 },
  { id: 'sec-modulo-4', titulo: 'Boca y garganta', orden: 4 },
  { id: 'sec-modulo-5', titulo: 'Sistema nervioso en manos y pies', orden: 5 },
  { id: 'sec-modulo-6', titulo: 'Piel y extremidades', orden: 6 },
  { id: 'sec-modulo-7', titulo: 'Sangrados y moretones', orden: 7 },
  { id: 'sec-modulo-8', titulo: 'Respiración y sistema cardiovascular', orden: 8 },
  { id: 'sec-modulo-9', titulo: 'Energía, ánimo y dolor general', orden: 9 },
  { id: 'sec-modulo-10', titulo: 'Comentario abierto', orden: 10 },
] as const;

export const SEGUIMIENTO_DOMICILIARIO_PREGUNTAS: MedicalFormBundleQuestion[] = [
  // --- MÓDULO 0: Contexto y dispositivos ---
  {
    preguntaId: 'P0.1',
    texto:
      '¿Tienes instalado un catéter para tu quimioterapia (como un "Port-a-cath" debajo de la piel en el pecho o un catéter PICC en el brazo)?',
    tipo: 'single_choice',
    orden: 0,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-0',
      sourceCode: 'P0.1',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P0.1.1',
    texto: '¿Cómo se ve y se siente la zona de tu piel donde está el catéter?',
    tipo: 'multiple_choice',
    orden: 1,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-0',
      sourceCode: 'P0.1.1',
      visibleWhen: { op: 'eq', questionId: 'P0.1', value: 'si' },
      opciones: [
        {
          valor: 'normal_sin_cambios',
          etiqueta: 'Se ve normal, sin dolor ni cambios.',
          esExcluyente: true,
        },
        {
          valor: 'sensible_picazon',
          etiqueta: 'Está un poco sensible o con leve picazón, pero sin cambios en la piel.',
        },
        {
          valor: 'roja_caliente_hinchada',
          etiqueta: 'Está roja, caliente al tocarla o hinchada.',
        },
        {
          valor: 'liquido_pus_sangre',
          etiqueta: 'Sale líquido, pus o sangre por el sitio del catéter.',
        },
        {
          valor: 'dolor_cuello_hombro_brazo',
          etiqueta:
            'Siento dolor o hinchazón en el cuello, hombro o en todo el brazo del lado del catéter.',
        },
      ],
    },
  },

  // --- MÓDULO 1: Fiebre e infección ---
  {
    preguntaId: 'P1',
    texto:
      '¿Has sentido fiebre, cuerpo cortado, sudoración fría o escalofríos (tiritones) en las últimas 24 horas?',
    tipo: 'single_choice',
    orden: 2,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P1.1',
    texto: '¿Qué síntomas has tenido exactamente?',
    tipo: 'single_choice',
    orden: 3,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1.1',
      visibleWhen: { op: 'eq', questionId: 'P1', value: 'si' },
      opciones: [
        {
          valor: 'calor_decaimiento',
          etiqueta: 'Solo sensación de calor o decaimiento, sin tiritones.',
        },
        {
          valor: 'tiritones_suaves',
          etiqueta: 'Escalofríos o tiritones suaves que pasaron rápido.',
        },
        {
          valor: 'tiritones_fuertes',
          etiqueta:
            'Escalofríos o tiritones fuertes e incontrolables (aunque el termómetro marque temperatura normal).',
        },
      ],
    },
  },
  {
    preguntaId: 'P1.2',
    texto: '¿Te tomaste la temperatura con un termómetro (en la axila o en la boca)?',
    tipo: 'single_choice',
    orden: 4,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1.2',
      visibleWhen: { op: 'eq', questionId: 'P1', value: 'si' },
      opciones: [
        {
          valor: 'menos_37_5',
          etiqueta: 'Menos de 37.5 (Normal).',
        },
        {
          valor: '37_5_a_37_9',
          etiqueta: 'Entre 37.5 a 37.9 (Febrícula).',
        },
        {
          valor: '38_a_38_2_mantenida',
          etiqueta: 'Entre 38 a 38.2 y se ha mantenido así por más de 1 hora.',
        },
        {
          valor: '38_3_mas',
          etiqueta: '38.3 o más en una sola toma.',
        },
        {
          valor: 'no_tomada',
          etiqueta: 'No me he tomado la temperatura con termómetro.',
        },
      ],
    },
  },
  {
    preguntaId: 'P1.3',
    texto:
      '¿Tomaste algún medicamento que baja la fiebre o para el dolor (como Paracetamol, Dipirona/Metamizol o Ibuprofeno) en las últimas 6 horas?',
    tipo: 'single_choice',
    orden: 5,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1.3',
      visibleWhen: { op: 'eq', questionId: 'P1', value: 'si' },
      opciones: [
        { valor: 'no', etiqueta: 'No he tomado nada.' },
        { valor: 'si', etiqueta: 'Sí, tomé un medicamento.' },
      ],
    },
  },
  {
    preguntaId: 'P1.4',
    texto: '¿Tienes alguna otra molestia que pueda indicar resfrío o infección?',
    tipo: 'multiple_choice',
    orden: 6,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1.4',
      visibleWhen: { op: 'eq', questionId: 'P1', value: 'si' },
      opciones: [
        {
          valor: 'garganta_tos',
          etiqueta: 'Dolor de garganta o tos nueva.',
        },
        {
          valor: 'ardor_orinar',
          etiqueta: 'Ardor o dolor al orinar.',
        },
        {
          valor: 'ninguna',
          etiqueta: 'Ninguna de las anteriores.',
          esExcluyente: true,
        },
      ],
    },
  },

  // --- MÓDULO 2: Náuseas y vómitos ---
  {
    preguntaId: 'P2',
    texto: '¿Has tenido náuseas (asco o ganas de vomitar) o vómitos en las últimas 24 horas?',
    tipo: 'single_choice',
    orden: 7,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-2',
      sourceCode: 'P2',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P2.1',
    texto: '¿Qué tan fuertes han sido las náuseas (ganas de vomitar)?',
    tipo: 'single_choice',
    orden: 8,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-2',
      sourceCode: 'P2.1',
      visibleWhen: { op: 'eq', questionId: 'P2', value: 'si' },
      opciones: [
        {
          valor: 'leves',
          etiqueta: 'Leves: Siento asco, pero puedo comer y tomar líquidos casi normal.',
        },
        {
          valor: 'moderadas',
          etiqueta:
            'Moderadas: Me cuesta comer, he comido bastante menos de lo habitual, pero logro tomar líquidos.',
        },
        {
          valor: 'severas',
          etiqueta:
            'Severas: El asco es constante y no me permite comer ni tomar casi nada de líquido.',
        },
      ],
    },
  },
  {
    preguntaId: 'P2.2',
    texto: '¿Has llegado a vomitar en las últimas 24 horas?',
    tipo: 'single_choice',
    orden: 9,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-2',
      sourceCode: 'P2.2',
      visibleWhen: { op: 'eq', questionId: 'P2', value: 'si' },
      opciones: [
        { valor: 'no_vomito', etiqueta: 'No he vomitado, solo tengo náuseas.' },
        { valor: 'vomito_1_2', etiqueta: 'Sí, vomité 1 o 2 veces en el día.' },
        {
          valor: 'vomito_3_5',
          etiqueta: 'Sí, he vomitado entre 3 y 5 veces en el día.',
        },
        {
          valor: 'vomito_6_mas',
          etiqueta:
            'Sí, he vomitado 6 veces o más, o vomito todo lo que intento tragar (incluso el agua).',
        },
      ],
    },
  },
  {
    preguntaId: 'P2.3',
    texto: '¿Cómo están funcionando los medicamentos contra las náuseas que te recetó tu médico?',
    tipo: 'single_choice',
    orden: 10,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-2',
      sourceCode: 'P2.3',
      visibleWhen: { op: 'eq', questionId: 'P2', value: 'si' },
      opciones: [
        {
          valor: 'alivian_bien',
          etiqueta: 'Me alivian bastante bien.',
        },
        {
          valor: 'alivian_poco',
          etiqueta: 'Me alivian muy poco, sigo con muchas molestias.',
        },
        {
          valor: 'vomita_medicamentos',
          etiqueta: 'No los puedo tomar porque los vomito apenas los trago.',
        },
        {
          valor: 'no_tomados',
          etiqueta: 'Aún no los he tomado.',
        },
      ],
    },
  },
  {
    preguntaId: 'P2.4',
    texto: 'Si vomitaste, ¿notaste algo extraño en el vómito?',
    tipo: 'single_choice',
    orden: 11,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-2',
      sourceCode: 'P2.4',
      visibleWhen: {
        op: 'all',
        conditions: [
          { op: 'eq', questionId: 'P2', value: 'si' },
          {
            op: 'in',
            questionId: 'P2.2',
            values: ['vomito_1_2', 'vomito_3_5', 'vomito_6_mas'],
          },
        ],
      },
      opciones: [
        {
          valor: 'normal_comida_liquido',
          etiqueta: 'No, era solo comida o líquido normal/amarillento.',
        },
        {
          valor: 'sangre_granos_cafe',
          etiqueta: 'Sí, tenía sangre roja o parecía tener "granos de café" oscuros.',
        },
      ],
    },
  },

  // --- MÓDULO 3: Tránsito intestinal ---
  {
    preguntaId: 'P3.A',
    texto: '¿Has tenido diarrea (deposiciones líquidas o sueltas) en las últimas 24 horas?',
    tipo: 'single_choice',
    orden: 12,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.A',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P3.A.1',
    texto: '¿Cuántas veces has tenido diarrea hoy (en comparación con tu ritmo normal)?',
    tipo: 'single_choice',
    orden: 13,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.A.1',
      visibleWhen: { op: 'eq', questionId: 'P3.A', value: 'si' },
      opciones: [
        { valor: '1_a_3', etiqueta: 'De 1 a 3 veces en el día (Leve).' },
        { valor: '4_a_6', etiqueta: 'De 4 a 6 veces en el día (Moderada).' },
        {
          valor: '7_mas',
          etiqueta:
            '7 veces o más en el día, o me despierta por la noche / no alcanzo a llegar al baño (Severa).',
        },
      ],
    },
  },
  {
    preguntaId: 'P3.A.2',
    texto: '¿Cómo se ven las deposiciones y qué otros síntomas sientes en el abdomen?',
    tipo: 'multiple_choice',
    orden: 14,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.A.2',
      visibleWhen: { op: 'eq', questionId: 'P3.A', value: 'si' },
      opciones: [
        {
          valor: 'liquidas_leves',
          etiqueta: 'Son solo líquidas, con molestias leves o sin dolor.',
          esExcluyente: true,
        },
        {
          valor: 'mucosidad_sangre',
          etiqueta: 'Tienen mucosidad o hilos de sangre roja.',
        },
        {
          valor: 'negras_alquitran',
          etiqueta: 'Son de color negro brillante (como alquitrán) y de olor muy fuerte.',
        },
        {
          valor: 'retorcijones_dolor_fuerte',
          etiqueta: 'Siento retorcijones o dolor abdominal muy fuerte que no se pasa.',
        },
      ],
    },
  },
  {
    preguntaId: 'P3.A.3',
    texto: '¿Has notado signos de deshidratación por la diarrea?',
    tipo: 'multiple_choice',
    orden: 15,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.A.3',
      visibleWhen: { op: 'eq', questionId: 'P3.A', value: 'si' },
      opciones: [
        {
          valor: 'bien_hidratado',
          etiqueta: 'No, me siento bien hidratado/a.',
          esExcluyente: true,
        },
        {
          valor: 'mucha_sed_boca_seca',
          etiqueta: 'Tengo mucha sed y la boca muy seca o pastosa.',
        },
        {
          valor: 'orina_poca_oscura',
          etiqueta: 'Orino muy poco y la orina es muy oscura (color té cargado).',
        },
        {
          valor: 'mareo_de_pie',
          etiqueta: 'Me mareo mucho cuando intento ponerme de pie.',
        },
      ],
    },
  },
  {
    preguntaId: 'P3.B',
    texto: '¿Has tenido estreñimiento (dificultad para ir al baño o deposiciones muy duras)?',
    tipo: 'single_choice',
    orden: 16,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.B',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P3.B.1',
    texto: '¿Cuántos días llevas sin poder hacer deposiciones?',
    tipo: 'single_choice',
    orden: 17,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.B.1',
      visibleWhen: { op: 'eq', questionId: 'P3.B', value: 'si' },
      opciones: [
        { valor: '1_a_2', etiqueta: '1 a 2 días.' },
        { valor: '3_a_4', etiqueta: '3 a 4 días.' },
        { valor: '5_mas', etiqueta: '5 días o más.' },
      ],
    },
  },
  {
    preguntaId: 'P3.B.2',
    texto: '¿Tienes el abdomen muy hinchado, duro, con dolor fuerte o no puedes eliminar gases?',
    tipo: 'single_choice',
    orden: 18,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.B.2',
      visibleWhen: { op: 'eq', questionId: 'P3.B', value: 'si' },
      opciones: [
        {
          valor: 'no',
          etiqueta: 'No, solo la molestia de no ir al baño.',
        },
        {
          valor: 'si',
          etiqueta: 'Sí, tengo dolor fuerte, abdomen duro o vómitos junto con el estreñimiento.',
        },
      ],
    },
  },

  // --- MÓDULO 4: Boca y garganta ---
  {
    preguntaId: 'P4',
    texto:
      '¿Sientes dolor, ardor, enrojecimiento o tienes llagas (heridas) dentro de la boca, lengua, encías o al tragar?',
    tipo: 'single_choice',
    orden: 19,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-4',
      sourceCode: 'P4',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P4.1',
    texto: '¿Qué observas dentro de tu boca?',
    tipo: 'multiple_choice',
    orden: 20,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-4',
      sourceCode: 'P4.1',
      visibleWhen: { op: 'eq', questionId: 'P4', value: 'si' },
      opciones: [
        {
          valor: 'roja_seca_sensible',
          etiqueta: 'Solo está roja, seca o sensible, sin heridas visibles.',
        },
        {
          valor: 'llagas_ulceras_pequenas',
          etiqueta: 'Tengo llagas o úlceras pequeñas.',
        },
        {
          valor: 'placas_blancas',
          etiqueta: 'Tengo placas blancas (como leche cortada) en la lengua o mejillas.',
        },
        {
          valor: 'heridas_sangran',
          etiqueta: 'Las heridas sangran solas o al comer.',
        },
      ],
    },
  },
  {
    preguntaId: 'P4.2',
    texto: '¿Cómo afecta esto a tu alimentación hoy?',
    tipo: 'single_choice',
    orden: 21,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-4',
      sourceCode: 'P4.2',
      visibleWhen: { op: 'eq', questionId: 'P4', value: 'si' },
      opciones: [
        {
          valor: 'normales_blandos',
          etiqueta:
            'Me molesta un poco, pero puedo comer alimentos normales o blandos sin problema.',
        },
        {
          valor: 'papillas_sopas_liquidos',
          etiqueta:
            'Me duele bastante; solo puedo comer papillas, sopas o líquidos, pero logro alimentarme.',
        },
        {
          valor: 'poco_agua_dificultad',
          etiqueta:
            'El dolor es tan intenso que solo puedo pasar un poco de agua o líquidos con mucha dificultad.',
        },
        {
          valor: 'no_tragar_nada',
          etiqueta: 'No puedo tragar absolutamente nada, ni agua ni mis medicamentos en pastillas.',
        },
      ],
    },
  },

  // --- MÓDULO 5: Sistema nervioso en manos y pies ---
  {
    preguntaId: 'P5',
    texto:
      '¿Sientes hormigueo, adormecimiento, "corrientazos" o dolor en los dedos de las manos o de los pies?',
    tipo: 'single_choice',
    orden: 22,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-5',
      sourceCode: 'P5',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P5.1',
    texto: '¿Cómo afecta esta sensación a tus actividades diarias?',
    tipo: 'single_choice',
    orden: 23,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-5',
      sourceCode: 'P5.1',
      visibleWhen: { op: 'eq', questionId: 'P5', value: 'si' },
      opciones: [
        {
          valor: 'leve_hormigueo',
          etiqueta: 'Es solo un hormigueo leve que no me molesta para hacer mis cosas.',
        },
        {
          valor: 'cosas_finas_manos',
          etiqueta:
            'Me cuesta hacer cosas finas con las manos (como abrocharme botones, escribir, abrir frascos o sostener una taza sin que se caiga).',
        },
        {
          valor: 'caminar_equilibrio_pies',
          etiqueta:
            'Me cuesta caminar bien, siento que no piso firme, tropiezo o pierdo el equilibrio por tener los pies dormidos.',
        },
      ],
    },
  },
  {
    preguntaId: 'P5.2',
    texto:
      '¿Sientes calambres o dolor en la garganta o en las manos cuando tocas cosas frías o tomas líquidos fríos?',
    tipo: 'single_choice',
    orden: 24,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-5',
      sourceCode: 'P5.2',
      visibleWhen: { op: 'eq', questionId: 'P5', value: 'si' },
      opciones: [
        { valor: 'no', etiqueta: 'No.' },
        {
          valor: 'molestia_frio_pasa_rapido',
          etiqueta: 'Sí, me da molestia o dolor con el frío, pero pasa rápido al calentarme.',
        },
        {
          valor: 'cierra_garganta_cuesta_respirar',
          etiqueta:
            'Sí, siento que se me cierra la garganta o me cuesta respirar al tomar o respirar algo frío.',
        },
      ],
    },
  },
  {
    preguntaId: 'P5.3',
    texto: 'En comparación con tu ciclo anterior de quimioterapia, ¿esta sensación ha cambiado?',
    tipo: 'single_choice',
    orden: 25,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-5',
      sourceCode: 'P5.3',
      visibleWhen: { op: 'eq', questionId: 'P5', value: 'si' },
      opciones: [
        {
          valor: 'igual_o_suave',
          etiqueta: 'Está igual o es más suave.',
        },
        {
          valor: 'nueva_empeorado_no_quita',
          etiqueta: 'Es nueva o ha empeorado y ya no se quita entre un ciclo y otro.',
        },
      ],
    },
  },

  // --- MÓDULO 6: Piel y extremidades ---
  {
    preguntaId: 'P6',
    texto:
      '¿Has notado enrojecimiento, hinchazón, dolor o descamación en las palmas de las manos, plantas de los pies o en el brazo donde te pusieron el suero?',
    tipo: 'single_choice',
    orden: 26,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-6',
      sourceCode: 'P6',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P6.1',
    texto: 'En las palmas de tus manos o plantas de tus pies, ¿qué síntomas tienes?',
    tipo: 'single_choice',
    orden: 27,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-6',
      sourceCode: 'P6.1',
      visibleWhen: { op: 'eq', questionId: 'P6', value: 'si' },
      opciones: [
        {
          valor: 'nada',
          etiqueta: 'No tengo nada en las palmas ni plantas.',
        },
        {
          valor: 'rojas_secas_sin_dolor',
          etiqueta:
            'Están un poco rojas o secas, pero no me duelen al caminar ni al usar las manos.',
        },
        {
          valor: 'rojas_hinchadas_pelando_dolor',
          etiqueta:
            'Están rojas, hinchadas, se están pelando y me duelen al caminar o al sostener objetos.',
        },
        {
          valor: 'ampollas_heridas_dolor_severo',
          etiqueta:
            'Tienen ampollas, heridas abiertas o costras, y el dolor no me deja caminar ni usar mis manos.',
        },
      ],
    },
  },
  {
    preguntaId: 'P6.2',
    texto:
      'En la vena del brazo donde te pasaron la quimioterapia (si no usas catéter central), ¿notaste algo?',
    tipo: 'single_choice',
    orden: 28,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-6',
      sourceCode: 'P6.2',
      visibleWhen: {
        op: 'all',
        conditions: [
          { op: 'eq', questionId: 'P6', value: 'si' },
          { op: 'eq', questionId: 'P0.1', value: 'no' },
        ],
      },
      opciones: [
        { valor: 'todo_normal', etiqueta: 'Todo normal.' },
        {
          valor: 'morado_pinchazo_sin_dolor',
          etiqueta: 'Está un poco morado por el pinchazo, pero sin dolor importante.',
        },
        {
          valor: 'hinchado_rojo_duro_caliente_arde',
          etiqueta:
            'Está muy hinchado, rojo, duro, caliente o me arde/duele mucho esa zona del brazo.',
        },
      ],
    },
  },

  // --- MÓDULO 7: Sangrados y moretones ---
  {
    preguntaId: 'P7',
    texto:
      '¿Has tenido algún tipo de sangrado o te han salido moretones o puntitos rojos en la piel sin haberte golpeado?',
    tipo: 'single_choice',
    orden: 29,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-7',
      sourceCode: 'P7',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P7.1',
    texto: '¿Qué tipo de sangrado o marcas has notado?',
    tipo: 'multiple_choice',
    orden: 30,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-7',
      sourceCode: 'P7.1',
      visibleWhen: { op: 'eq', questionId: 'P7', value: 'si' },
      opciones: [
        {
          valor: 'pequeno_sangrado_menos_5min',
          etiqueta:
            'Pequeño sangrado de encías al cepillarme los dientes o gotitas de sangre al sonarme la nariz, que se detiene en menos de 5 minutos.',
        },
        {
          valor: 'moretones_petequias',
          etiqueta:
            'Me salieron varios moretones nuevos sin golpearme o muchos puntitos rojos pequeños en las piernas o brazos (petequias).',
        },
        {
          valor: 'sangrado_nariz_encias_10_15min',
          etiqueta:
            'Sangrado de nariz o encías abundante que no se detiene después de apretar durante 10 a 15 minutos.',
        },
        {
          valor: 'orina_sangre_ardor',
          etiqueta: 'Orina de color rojo o rosado (con sangre) o ardor fuerte al orinar.',
        },
        {
          valor: 'sangrado_vaginal_tos_sangre',
          etiqueta: 'Sangrado vaginal abundante fuera de mi regla normal, o tos con sangre.',
        },
      ],
    },
  },

  // --- MÓDULO 8: Respiración y sistema cardiovascular ---
  {
    preguntaId: 'P8',
    texto:
      '¿Sientes falta de aire al respirar, dolor en el pecho, palpitaciones o se te ha hinchado alguna pierna?',
    tipo: 'single_choice',
    orden: 31,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-8',
      sourceCode: 'P8',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P8.1',
    texto: '¿Cómo es la falta de aire o dificultad para respirar?',
    tipo: 'single_choice',
    orden: 32,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-8',
      sourceCode: 'P8.1',
      visibleWhen: { op: 'eq', questionId: 'P8', value: 'si' },
      opciones: [
        {
          valor: 'no_falta_aire',
          etiqueta: 'No tengo falta de aire.',
        },
        {
          valor: 'canso_escaleras_rapido',
          etiqueta:
            'Me canso un poco más de lo normal al subir escaleras o caminar rápido, pero se me pasa al descansar.',
        },
        {
          valor: 'falta_aire_minimas_almohadas',
          etiqueta:
            'Me falta el aire haciendo cosas mínimas (como vestirme o ir al baño) o necesito dormir con más almohadas para no ahogarme.',
        },
        {
          valor: 'falta_aire_reposo',
          etiqueta: 'Me falta el aire estando totalmente quieto/a y en reposo.',
        },
      ],
    },
  },
  {
    preguntaId: 'P8.2',
    texto: '¿Tienes alguno de estos síntomas en el pecho?',
    tipo: 'multiple_choice',
    orden: 33,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-8',
      sourceCode: 'P8.2',
      visibleWhen: { op: 'eq', questionId: 'P8', value: 'si' },
      opciones: [
        {
          valor: 'ninguno',
          etiqueta: 'Ninguno.',
          esExcluyente: true,
        },
        {
          valor: 'dolor_presion_pesadez',
          etiqueta: 'Dolor, presión o pesadez en el centro del pecho.',
        },
        {
          valor: 'palpitaciones_reposo',
          etiqueta:
            'Siento que el corazón me late muy rápido o desordenado (palpitaciones) estando en reposo.',
        },
      ],
    },
  },
  {
    preguntaId: 'P8.3',
    texto: '¿Se te han hinchado las piernas o los tobillos?',
    tipo: 'single_choice',
    orden: 34,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-8',
      sourceCode: 'P8.3',
      visibleWhen: { op: 'eq', questionId: 'P8', value: 'si' },
      opciones: [
        { valor: 'no', etiqueta: 'No.' },
        {
          valor: 'tobillos_hinchados_final_dia',
          etiqueta: 'Sí, ambos tobillos están un poco hinchados al final del día.',
        },
        {
          valor: 'una_pierna_repente_duele_caliente',
          etiqueta:
            'Sí, una sola pierna (o pantorrilla) se hinchó de repente, me duele, está roja o caliente.',
        },
      ],
    },
  },

  // --- MÓDULO 9: Energía, ánimo y dolor general ---
  {
    preguntaId: 'P9.A',
    texto:
      '¿Has sentido un cansancio extremo o fatiga que no se alivia aunque duermas o descanses?',
    tipo: 'single_choice',
    orden: 35,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-9',
      sourceCode: 'P9.A',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P9.A.1',
    texto: '¿Qué tanto te limita este cansancio hoy?',
    tipo: 'single_choice',
    orden: 36,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-9',
      sourceCode: 'P9.A.1',
      visibleWhen: { op: 'eq', questionId: 'P9.A', value: 'si' },
      opciones: [
        {
          valor: 'ecog_1',
          etiqueta:
            'Me siento cansado/a, pero puedo levantarme y hacer casi todas mis actividades del día.',
        },
        {
          valor: 'ecog_2',
          etiqueta:
            'Paso menos de la mitad del día en cama o en el sillón; puedo bañarme y vestirme solo/a, pero no puedo trabajar ni hacer tareas de la casa.',
        },
        {
          valor: 'ecog_3_4',
          etiqueta:
            'Paso más de la mitad del día en cama; me cuesta mucho levantarme incluso para bañarme, vestirme o comer.',
        },
        {
          valor: 'emergencia',
          etiqueta:
            'Además del cansancio, me siento confundido/a, me cuesta mucho despertar o me he desmayado.',
        },
      ],
    },
  },
  {
    preguntaId: 'P9.B',
    texto: '¿Tienes algún dolor en el cuerpo (huesos, músculos, cabeza o zona de tu enfermedad)?',
    tipo: 'single_choice',
    orden: 37,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-9',
      sourceCode: 'P9.B',
      opciones: [
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ],
    },
  },
  {
    preguntaId: 'P9.B.1',
    texto: '¿Qué tan intenso es el dolor en este momento?',
    tipo: 'single_choice',
    orden: 38,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-9',
      sourceCode: 'P9.B.1',
      visibleWhen: { op: 'eq', questionId: 'P9.B', value: 'si' },
      opciones: [
        {
          valor: 'leve',
          etiqueta: 'Dolor Leve (1 a 3): Molesta un poco, pero me deja dormir y hacer mis cosas.',
        },
        {
          valor: 'moderado',
          etiqueta: 'Dolor Moderado (4 a 6): Me interrumpe mis actividades o el sueño.',
        },
        {
          valor: 'intenso',
          etiqueta:
            'Dolor Intenso o Insoportable (7 a 10): No me deja estar tranquilo/a ni dormir.',
        },
      ],
    },
  },
  {
    preguntaId: 'P9.B.2',
    texto: '¿Cómo responde el dolor a los analgésicos que te dejó tu médico?',
    tipo: 'single_choice',
    orden: 39,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-9',
      sourceCode: 'P9.B.2',
      visibleWhen: { op: 'eq', questionId: 'P9.B', value: 'si' },
      opciones: [
        {
          valor: 'alivia_bien',
          etiqueta: 'El dolor se pasa bien cuando tomo mis medicamentos.',
        },
        {
          valor: 'alivia_parcial',
          etiqueta: 'El dolor baja un poco, pero vuelve antes de que me toque la siguiente dosis.',
        },
        {
          valor: 'no_se_pasa_o_subito',
          etiqueta: 'El dolor no se pasa con nada o apareció de forma súbita y muy violenta.',
        },
      ],
    },
  },

  // --- MÓDULO 10: Comentario abierto ---
  {
    preguntaId: 'P10',
    texto:
      '¿Hay algún otro síntoma, duda o comentario que quieras contarle a tu equipo médico o de enfermería y que no hayamos preguntado arriba?',
    tipo: 'text',
    orden: 40,
    requerida: false,
    configuracion: {
      sectionId: 'sec-modulo-10',
      sourceCode: 'P10',
      maxLength: 500,
    },
  },
];

export const SEGUIMIENTO_DOMICILIARIO_BUNDLE_ITEM: MedicalFormBundleItem = {
  formularioId: SEGUIMIENTO_DOMICILIARIO_FORM_ID,
  version: SEGUIMIENTO_DOMICILIARIO_VERSION,
  titulo: 'Seguimiento domiciliario diario',
  descripcion: 'Cuestionario diario de seguimiento de síntomas para pacientes en quimioterapia.',
  duracionEstimadaMin: 5,
  configuracion: {
    periodicidad: 'daily',
    schemaVersion: 1,
    secciones: [...SEGUIMIENTO_DOMICILIARIO_SECCIONES],
  },
  preguntas: SEGUIMIENTO_DOMICILIARIO_PREGUNTAS,
};

export const SEGUIMIENTO_DOMICILIARIO_FIXTURE = SEGUIMIENTO_DOMICILIARIO_BUNDLE_ITEM;
