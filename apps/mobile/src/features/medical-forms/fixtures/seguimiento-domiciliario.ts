import type {
  MedicalFormBundleItem,
  MedicalFormBundleQuestion,
} from '../../../data/local/forms/form-types';

/**
 * Fixture técnico provisional del instrumento suministrado (Cuestionario de Seguimiento Domiciliario ePRO).
 * Incorpora las 41 preguntas definidas en 11 módulos, preservando textos, alternativas y códigos de referencia.
 *
 * AVISO ARQUITECTÓNICO:
 * Este instrumento constituye un caso de compatibilidad y prueba técnica demostrativa en modo demo.
 * No atribuye diagnóstico médico, clasificación automática de gravedad ni atención clínica en tiempo real.
 */
export const SEGUIMIENTO_DOMICILIARIO_FORM_ID = 'seguimiento-domiciliario';
export const SEGUIMIENTO_DOMICILIARIO_VERSION = '1.0.0';

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
          valor: 'bien_sin_molestias',
          etiqueta:
            'Se ve sana, sin cambios, no me duele y no tengo secreción ni líquido saliendo.',
          esExcluyente: true,
        },
        { valor: 'enrojecida', etiqueta: 'Está enrojecida o tibia al tacto.' },
        { valor: 'hinchada', etiqueta: 'Está hinchada o la siento dura.' },
        { valor: 'dolor', etiqueta: 'Me duele al tocarla o espontáneamente.' },
        {
          valor: 'secrecion',
          etiqueta: 'Sale líquido, pus o sangre alrededor del catéter.',
        },
      ],
    },
  },

  // --- MÓDULO 1: Fiebre e infección ---
  {
    preguntaId: 'P1',
    texto:
      'En las últimas 24 horas, ¿has sentido fiebre, escalofríos intensos o temblores con castañeo de dientes?',
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
    texto: 'Si te mediste la temperatura con un termómetro, ¿cuál fue la cifra más alta que marcó?',
    tipo: 'single_choice',
    orden: 3,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1.1',
      visibleWhen: { op: 'eq', questionId: 'P1', value: 'si' },
      opciones: [
        {
          valor: 'menos_38',
          etiqueta: 'Menos de 38.0 °C (o no me la medí, pero sentí mucho frío o temblores).',
        },
        { valor: '38_a_38_2', etiqueta: 'Entre 38.0 °C y 38.2 °C.' },
        { valor: '38_3_mas', etiqueta: '38.3 °C o más.' },
      ],
    },
  },
  {
    preguntaId: 'P1.2',
    texto: 'Si tu temperatura estuvo entre 38.0 °C y 38.2 °C, ¿cuánto tiempo duró?',
    tipo: 'single_choice',
    orden: 4,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1.2',
      visibleWhen: { op: 'eq', questionId: 'P1', value: 'si' },
      opciones: [
        {
          valor: 'no_aplica',
          etiqueta: 'Mi temperatura fue menor a 38 °C o fue de 38.3 °C o más.',
        },
        { valor: 'bajo_rapido', etiqueta: 'Bajó rápido (duró menos de una hora).' },
        {
          valor: 'mantuvo_1_hora',
          etiqueta: 'Se mantuvo en 38.0 °C o más durante 1 hora o más.',
        },
        {
          valor: 'repitio_dos_veces',
          etiqueta: 'Se repitió 2 o más veces durante el día.',
        },
        { valor: 'no_pude_medir', etiqueta: 'No pude volver a medirla.' },
      ],
    },
  },
  {
    preguntaId: 'P1.3',
    texto:
      '¿Tomaste algún medicamento para bajar la fiebre (como paracetamol) en las últimas 24 horas?',
    tipo: 'single_choice',
    orden: 5,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1.3',
      visibleWhen: { op: 'eq', questionId: 'P1', value: 'si' },
      opciones: [
        { valor: 'no', etiqueta: 'No tomé nada para la fiebre.' },
        { valor: 'si', etiqueta: 'Sí, tomé medicamento para la fiebre.' },
      ],
    },
  },
  {
    preguntaId: 'P1.4',
    texto: '¿Sientes alguno de estos otros problemas acompañando al malestar o la fiebre?',
    tipo: 'multiple_choice',
    orden: 6,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-1',
      sourceCode: 'P1.4',
      visibleWhen: { op: 'eq', questionId: 'P1', value: 'si' },
      opciones: [
        {
          valor: 'ninguno',
          etiqueta: 'Ninguno de los anteriores, solo la fiebre o malestar general.',
          esExcluyente: true,
        },
        {
          valor: 'ardor_orinar',
          etiqueta: 'Ardor intenso al orinar o necesidad de orinar a cada rato.',
        },
        {
          valor: 'tos_flemas',
          etiqueta: 'Tos con flemas de color amarillo, verde o con sangre.',
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
          etiqueta: 'Leves: Tengo un poco de asco, pero puedo comer y tomar líquidos normalmente.',
        },
        {
          valor: 'moderadas',
          etiqueta: 'Moderadas: Me cuesta comer, tomo menos líquidos de lo normal, pero no vomito.',
        },
        {
          valor: 'severas',
          etiqueta:
            'Severas: El asco es constante, no puedo comer casi nada y apenas tolero el agua.',
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
          valor: 'bien',
          etiqueta: 'Bien, me controlan las molestias casi por completo.',
        },
        {
          valor: 'algo',
          etiqueta: 'Me alivian un poco, pero sigo con molestias.',
        },
        {
          valor: 'nada',
          etiqueta: 'No me hacen ningún efecto, sigo igual de mal.',
        },
        {
          valor: 'no_indicados',
          etiqueta: 'No me dejaron medicamentos indicados o no los tomé.',
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
          valor: 'alimentos',
          etiqueta: 'No, solo comida, saliva o líquido amarillo/transparente.',
        },
        {
          valor: 'sangre_cafe',
          etiqueta: 'Sí, vi sangre roja fresca o tenía aspecto oscuro como borra de café.',
        },
      ],
    },
  },

  // --- MÓDULO 3: Tránsito intestinal ---
  {
    preguntaId: 'P3.A',
    texto:
      '¿Has tenido diarrea (deposiciones sueltas, líquidas o más frecuentes de lo normal) en las últimas 24 horas?',
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
    texto: '¿Cuántas veces más de lo que acostumbras fuiste al baño con diarrea hoy?',
    tipo: 'single_choice',
    orden: 13,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.A.1',
      visibleWhen: { op: 'eq', questionId: 'P3.A', value: 'si' },
      opciones: [
        { valor: '1_a_3', etiqueta: 'De 1 a 3 veces más de lo habitual.' },
        { valor: '4_a_6', etiqueta: 'De 4 a 6 veces más de lo habitual.' },
        { valor: '7_mas', etiqueta: '7 o más veces más de lo habitual.' },
      ],
    },
  },
  {
    preguntaId: 'P3.A.2',
    texto: '¿Acompaña a la diarrea alguno de estos síntomas?',
    tipo: 'multiple_choice',
    orden: 14,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.A.2',
      visibleWhen: { op: 'eq', questionId: 'P3.A', value: 'si' },
      opciones: [
        {
          valor: 'ninguno',
          etiqueta: 'Ninguno de los anteriores.',
          esExcluyente: true,
        },
        {
          valor: 'sangre_moco',
          etiqueta: 'Veo sangre o moco en las deposiciones.',
        },
        {
          valor: 'dolor_retorcijones',
          etiqueta: 'Tengo cólicos o retorcijones abdominales fuertes que no se calman.',
        },
        {
          valor: 'mareo_boca_seca',
          etiqueta: 'Siento la boca muy seca, mareos al ponerme de pie o orino muy poco.',
        },
      ],
    },
  },
  {
    preguntaId: 'P3.A.3',
    texto: '¿Qué medidas o medicamentos has tomado para la diarrea?',
    tipo: 'multiple_choice',
    orden: 15,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.A.3',
      visibleWhen: { op: 'eq', questionId: 'P3.A', value: 'si' },
      opciones: [
        {
          valor: 'hidratacion',
          etiqueta: 'Estoy tomando abundantes líquidos (sales de rehidratación, agua, caldos).',
        },
        {
          valor: 'medicamento_indicado',
          etiqueta: 'Tomé el antidiarreico que me indicó mi médico (por ejemplo, loperamida).',
        },
        {
          valor: 'sin_medicacion',
          etiqueta: 'No he tomado medicamentos para la diarrea.',
        },
        {
          valor: 'automedicacion',
          etiqueta: 'Tomé otro medicamento por mi cuenta.',
        },
      ],
    },
  },
  {
    preguntaId: 'P3.B',
    texto: '¿Tienes estreñimiento (dificultad para defecar o llevas días sin poder ir al baño)?',
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
    texto: '¿Cuántos días llevas sin poder evacuar el intestino?',
    tipo: 'single_choice',
    orden: 17,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.B.1',
      visibleWhen: { op: 'eq', questionId: 'P3.B', value: 'si' },
      opciones: [
        { valor: '1_a_2', etiqueta: '1 o 2 días más de lo habitual para mí.' },
        { valor: '3_a_4', etiqueta: '3 o 4 días seguidos sin evacuar.' },
        { valor: '5_mas', etiqueta: '5 días o más sin poder evacuar.' },
      ],
    },
  },
  {
    preguntaId: 'P3.B.2',
    texto:
      '¿Acompaña al estreñimiento dolor de guata fuerte, hinchazón dura o náuseas con vómitos?',
    tipo: 'single_choice',
    orden: 18,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-3',
      sourceCode: 'P3.B.2',
      visibleWhen: { op: 'eq', questionId: 'P3.B', value: 'si' },
      opciones: [
        { valor: 'no', etiqueta: 'No, solo la molestia de no poder ir al baño.' },
        {
          valor: 'si',
          etiqueta: 'Sí, tengo dolor abdominal fuerte, vómitos o la guata muy hinchada y dura.',
        },
      ],
    },
  },

  // --- MÓDULO 4: Boca y garganta ---
  {
    preguntaId: 'P4',
    texto:
      '¿Sientes molestias, ardor, dolor o heridas en la boca, encías, lengua o garganta (mucositis)?',
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
    texto: '¿Cómo se ven y se sienten las molestias en tu boca?',
    tipo: 'multiple_choice',
    orden: 20,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-4',
      sourceCode: 'P4.1',
      visibleWhen: { op: 'eq', questionId: 'P4', value: 'si' },
      opciones: [
        {
          valor: 'rojo_ardor',
          etiqueta: 'Boca o encías rojas, me arde con comidas ácidas, saladas o calientes.',
        },
        {
          valor: 'aftas',
          etiqueta: 'Tengo llagas, aftas o pequeñas heridas dolorosas en la lengua o labios.',
        },
        {
          valor: 'manchas_blancas',
          etiqueta: 'Tengo placas o manchas blancas como leche cortada en la lengua o mejillas.',
        },
        {
          valor: 'sangrado',
          etiqueta: 'Me sangran las encías o las heridas de la boca espontáneamente.',
        },
      ],
    },
  },
  {
    preguntaId: 'P4.2',
    texto: '¿Qué tanto te impide este dolor comer o beber?',
    tipo: 'single_choice',
    orden: 21,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-4',
      sourceCode: 'P4.2',
      visibleWhen: { op: 'eq', questionId: 'P4', value: 'si' },
      opciones: [
        {
          valor: 'como_bien',
          etiqueta: 'Puedo comer y tragar alimentos normales sin gran dificultad.',
        },
        {
          valor: 'solo_blandos',
          etiqueta: 'Solo puedo tragar alimentos blandos o molidos; los sólidos me duelen mucho.',
        },
        {
          valor: 'solo_liquidos',
          etiqueta: 'Solo puedo tragar líquidos; no tolero ningún alimento sólido.',
        },
        {
          valor: 'no_pasa_agua',
          etiqueta: 'No puedo tragar ni siquiera mi propia saliva o el agua del dolor tan intenso.',
        },
      ],
    },
  },

  // --- MÓDULO 5: Sistema nervioso en manos y pies ---
  {
    preguntaId: 'P5',
    texto:
      '¿Has sentido hormigueo, adormecimiento, sensación de pinchazos o dolor en las manos o en los pies?',
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
    texto: '¿Qué tanto interfiere esta molestia en tus manos o pies para hacer tus cosas?',
    tipo: 'single_choice',
    orden: 23,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-5',
      sourceCode: 'P5.1',
      visibleWhen: { op: 'eq', questionId: 'P5', value: 'si' },
      opciones: [
        {
          valor: 'leve',
          etiqueta:
            'Molestia leve: Lo siento, pero no me impide abotonarme la ropa, escribir o caminar.',
        },
        {
          valor: 'moderada',
          etiqueta:
            'Molestia moderada: Me cuesta tomar cosas pequeñas, abotonarme o siento los pies acolchados al caminar.',
        },
        {
          valor: 'severa',
          etiqueta:
            'Molestia severa: Se me caen las cosas de las manos, tropiezo o pierdo el equilibrio al caminar.',
        },
      ],
    },
  },
  {
    preguntaId: 'P5.2',
    texto:
      'Al tocar objetos fríos, abrir el refrigerador o tomar agua fría, ¿sientes dolor o calambres en las manos o garganta?',
    tipo: 'single_choice',
    orden: 24,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-5',
      sourceCode: 'P5.2',
      visibleWhen: { op: 'eq', questionId: 'P5', value: 'si' },
      opciones: [
        { valor: 'no', etiqueta: 'No me molesta el frío.' },
        {
          valor: 'un_poco',
          etiqueta: 'Sí, siento pinchazos molestos, pero se pasa rápido al alejar el frío.',
        },
        {
          valor: 'intenso_espasmo',
          etiqueta:
            'Sí, el dolor es muy intenso o siento que se me cierra la garganta al respirar aire frío o tomar agua helada.',
        },
      ],
    },
  },
  {
    preguntaId: 'P5.3',
    texto:
      'Comparado con el ciclo anterior de quimioterapia, ¿esta molestia en manos/pies ha empeorado?',
    tipo: 'single_choice',
    orden: 25,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-5',
      sourceCode: 'P5.3',
      visibleWhen: { op: 'eq', questionId: 'P5', value: 'si' },
      opciones: [
        {
          valor: 'igual_o_mejor',
          etiqueta: 'Está igual que antes o ha ido mejorando con los días.',
        },
        {
          valor: 'peor_o_nueva',
          etiqueta: 'Está claramente peor, dura más días o es la primera vez que me pasa.',
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
          valor: 'enrojecimiento_leve',
          etiqueta: 'Enrojecimiento leve o sensación de hormigueo, sin dolor.',
        },
        {
          valor: 'enrojecimiento_dolor',
          etiqueta:
            'Enrojecimiento con hinchazón y dolor que me molesta para caminar o tomar cosas.',
        },
        {
          valor: 'ampollas_descamacion',
          etiqueta: 'Ampollas, descamación de la piel, heridas abiertas o dolor severo.',
        },
        {
          valor: 'sin_molestias_manos_pies',
          etiqueta: 'No tengo molestias en manos ni pies (la molestia es en el brazo del suero).',
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
        { valor: 'normal', etiqueta: 'La piel y la vena se ven normales.' },
        {
          valor: 'dura_oscura',
          etiqueta: 'La vena se siente como un cordón duro o se puso de color oscuro/morado.',
        },
        {
          valor: 'roja_caliente_ardor',
          etiqueta:
            'La zona donde estuvo la aguja está roja, caliente, muy hinchada o con ardor/dolor intenso.',
        },
      ],
    },
  },

  // --- MÓDULO 7: Sangrados y moretones ---
  {
    preguntaId: 'P7',
    texto:
      '¿Has notado moretones nuevos sin haberte golpeado, puntos rojos en la piel o sangrado por la nariz, encías, orina o deposiciones?',
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
    texto: '¿Dónde o cómo has notado este sangrado o manchas en la piel?',
    tipo: 'multiple_choice',
    orden: 30,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-7',
      sourceCode: 'P7.1',
      visibleWhen: { op: 'eq', questionId: 'P7', value: 'si' },
      opciones: [
        {
          valor: 'moretones',
          etiqueta: 'Moretones en brazos o piernas que aparecieron solos.',
        },
        {
          valor: 'puntos_rojos',
          etiqueta: 'Puntos rojos o morados pequeños en las piernas o brazos (petequias).',
        },
        {
          valor: 'sangrado_nariz_encias',
          etiqueta:
            'Sangrado de encías al lavarme los dientes o sangre por la nariz que para en pocos minutos.',
        },
        {
          valor: 'orina_deposiciones_rojas',
          etiqueta: 'Orina rosada/roja, o deposiciones negras como carbón o con sangre visible.',
        },
        {
          valor: 'sangrado_abundante',
          etiqueta:
            'Sangrado por la nariz o una herida que no para después de 10 minutos de presionar.',
        },
      ],
    },
  },

  // --- MÓDULO 8: Respiración y sistema cardiovascular ---
  {
    preguntaId: 'P8',
    texto:
      '¿Has sentido falta de aire, ahogo, palpitaciones en el pecho o dolor en las piernas en las últimas 24 horas?',
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
    texto: '¿En qué momento sientes que te falta el aire o te ahogas?',
    tipo: 'single_choice',
    orden: 32,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-8',
      sourceCode: 'P8.1',
      visibleWhen: { op: 'eq', questionId: 'P8', value: 'si' },
      opciones: [
        {
          valor: 'esfuerzo',
          etiqueta:
            'Solo cuando hago esfuerzos grandes (subir escaleras rápido, caminar apurado/a).',
        },
        {
          valor: 'caminar',
          etiqueta: 'Al caminar lento en plano o al vestirme y hacer cosas cotidianas.',
        },
        {
          valor: 'reposo',
          etiqueta: 'Estando sentado/a o acostado/a sin moverme, siento que no me entra el aire.',
        },
        {
          valor: 'no_falta_aire',
          etiqueta: 'No siento falta de aire (el síntoma es en el pecho o en las piernas).',
        },
      ],
    },
  },
  {
    preguntaId: 'P8.2',
    texto: '¿Sientes alguno de estos problemas en el pecho?',
    tipo: 'multiple_choice',
    orden: 33,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-8',
      sourceCode: 'P8.2',
      visibleWhen: { op: 'eq', questionId: 'P8', value: 'si' },
      opciones: [
        {
          valor: 'ninguno_pecho',
          etiqueta: 'Ninguno de los anteriores en el pecho.',
          esExcluyente: true,
        },
        {
          valor: 'dolor_opresion',
          etiqueta: 'Dolor o sensación de opresión fuerte en el centro del pecho que se aprieta.',
        },
        {
          valor: 'palpitaciones',
          etiqueta: 'El corazón late muy rápido, desordenado o siento brincos en el pecho.',
        },
      ],
    },
  },
  {
    preguntaId: 'P8.3',
    texto: '¿Has notado hinchazón o dolor en una sola pierna?',
    tipo: 'single_choice',
    orden: 34,
    requerida: true,
    configuracion: {
      sectionId: 'sec-modulo-8',
      sourceCode: 'P8.3',
      visibleWhen: { op: 'eq', questionId: 'P8', value: 'si' },
      opciones: [
        { valor: 'no_piernas', etiqueta: 'No, mis piernas están normales.' },
        {
          valor: 'hinchazon_ambas',
          etiqueta: 'Tengo ambas piernas un poco hinchadas por igual (al final del día).',
        },
        {
          valor: 'hinchazon_dolor_una',
          etiqueta:
            'Una sola pierna (pantorrilla o muslo) está hinchada, roja, caliente o muy dolorosa.',
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
          etiqueta: 'El dolor se pasa o baja mucho con los medicamentos indicados.',
        },
        {
          valor: 'alivia_poco',
          etiqueta: 'El medicamento casi no me quita el dolor o el alivio dura muy poco rato.',
        },
        {
          valor: 'no_indicados',
          etiqueta: 'No me indicaron medicamentos para el dolor o no los he tomado.',
        },
      ],
    },
  },

  // --- MÓDULO 10: Comentario abierto ---
  {
    preguntaId: 'P10',
    texto:
      '¿Hay algo más sobre cómo te sientes hoy que quieras registrar o comentarle a tu equipo de salud?',
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
