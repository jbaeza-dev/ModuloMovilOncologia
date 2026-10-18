import type { EducationalResource } from '../../data/local/education/education-types';
import { EDUCATIONAL_CATEGORIES } from './educational-categories';

export interface EducationalCategoryItem {
  id: number;
  slug: string;
  title: string;
  icon: string;
  count: string;
}

export const SAMPLE_EDUCATIONAL_CATEGORIES: readonly EducationalCategoryItem[] =
  EDUCATIONAL_CATEGORIES.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    icon: c.icon,
    count: '2 contenidos',
  }));

export const SAMPLE_EDUCATIONAL_CATALOG: readonly EducationalResource[] = [
  // Categoría 0: Proceso de quimioterapia
  {
    id: 'edu-video-induccion',
    category: 0,
    categoryName: 'Proceso de quimioterapia',
    categorySlug: 'proceso-quimioterapia',
    title: 'Video: Conoce tu proceso de tratamiento',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 6,
    description: 'Orientación en video sobre la sala de infusión y acompañamiento médico.',
    youtubeVideoId: 'psfP_n8eP40',
  },
  {
    id: 'edu-infografia-ciclo-quimio',
    category: 0,
    categoryName: 'Proceso de quimioterapia',
    categorySlug: 'proceso-quimioterapia',
    title: 'Infografía: Fases del ciclo de quimioterapia',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 3,
    description: 'Esquema visual de las etapas de infusión, descanso y control médico.',
    textoAccesible:
      'Guía visual del ciclo de quimioterapia:\n\n' +
      '1. FASE PREVIA: Exámenes de laboratorio de control y consulta de evaluación médica.\n' +
      '2. DÍA DE INFUSIÓN: Llegada al centro asistencial, verificación de signos vitales, administración de premedicación y posterior infusión del tratamiento según pauta médica.\n' +
      '3. DÍAS DE DESCANSO: Periodo en domicilio orientado al reposo, hidratación constante y observación de cómo se siente el cuerpo.\n' +
      '4. CONTROL Y SEGUIMIENTO: Evaluación médica antes de iniciar el siguiente ciclo programado.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },

  // Categoría 1: Manejo de síntomas
  {
    id: 'edu-infografia-termometro-alerta',
    category: 1,
    categoryName: 'Manejo de síntomas',
    categorySlug: 'manejo-sintomas',
    title: 'Infografía: Señales de alerta y termometría',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 2,
    description: 'Pautas de observación domiciliaria y registro de temperatura corporal.',
    textoAccesible:
      'Pautas de observación domiciliaria:\n\n' +
      '• CONTROL DE TEMPERATURA: Medir la temperatura axilar ante sensación febril o escalofríos. Registrar el valor exacto para comentarlo al equipo de salud.\n' +
      '• OBSERVACIÓN GENERAL: Prestar atención a cambios repentinos de energía, náuseas persistentes o dolor que no cede con la indicación médica habitual.\n' +
      '• COMUNICACIÓN: Mantener a mano los teléfonos de contacto del centro asistencial entregados por el equipo médico.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-alivio-sintomas',
    category: 1,
    categoryName: 'Manejo de síntomas',
    categorySlug: 'manejo-sintomas',
    title: 'Video: Consejos prácticos ante molestias frecuentes',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 5,
    description: 'Técnicas sencillas de respiración y descanso tras la infusión.',
    youtubeVideoId: 'dQw4w9WgXcQ',
  },

  // Categoría 2: Nutrición e hidratación
  {
    id: 'edu-infografia-alimentacion',
    category: 2,
    categoryName: 'Nutrición e hidratación',
    categorySlug: 'nutricion-hidratacion',
    title: 'Infografía: Guía nutricional en quimioterapia',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 2,
    description: 'Póster ilustrado con 3 pilares: hidratación, porciones y cocción segura.',
    textoAccesible:
      'Tres pilares nutricionales durante el tratamiento:\n\n' +
      '1. HIDRATACIÓN CONSTANTE: Beber agua y líquidos claros en pequeños sorbos a lo largo de toda la jornada.\n' +
      '2. FRACCIONAMIENTO: Preferir comidas pequeñas y frecuentes en lugar de platos abundantes, respetando el apetito y la tolerancia del momento.\n' +
      '3. HIGIENE Y COCCIÓN: Consumir alimentos bien cocidos, lavar minuciosamente frutas y verduras peladas, y mantener refrigeración adecuada.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-hidratacion-facil',
    category: 2,
    categoryName: 'Nutrición e hidratación',
    categorySlug: 'nutricion-hidratacion',
    title: 'Video: Opciones de líquidos e hidratación diaria',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 4,
    description: 'Ideas de caldos tibios e infusiones suaves durante los ciclos.',
    youtubeVideoId: 'psfP_n8eP40',
  },

  // Categoría 3: Actividad física y descanso
  {
    id: 'edu-infografia-higiene-sueno',
    category: 3,
    categoryName: 'Actividad física y descanso',
    categorySlug: 'actividad-descanso',
    title: 'Infografía: Rutina de descanso y sueño reparador',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 2,
    description: 'Hábitos diarios para favorecer el descanso nocturno.',
    textoAccesible:
      'Recomendaciones para un buen descanso:\n\n' +
      '• AMBIENTE: Mantener el dormitorio fresco, ventilado y con poca iluminación.\n' +
      '• DESCONEXIÓN: Evitar pantallas de teléfonos o televisores al menos 30 minutos antes de acostarse.\n' +
      '• PAUSAS: Si se requiere descansar durante el día, realizar siestas breves de 20 a 30 minutos para no interferir con el sueño nocturno.\n' +
      '• RITMO: Acostarse y levantarse en horarios regulares dentro de lo posible.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-ejercicios-suaves',
    category: 3,
    categoryName: 'Actividad física y descanso',
    categorySlug: 'actividad-descanso',
    title: 'Video: Movilidad suave y pausas activas',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 4,
    description: 'Estiramientos ligeros adaptados para realizar en casa sin forzar el cuerpo.',
    youtubeVideoId: 'psfP_n8eP40',
  },

  // Categoría 4: Cuidado emocional
  {
    id: 'edu-infografia-pausas-calma',
    category: 4,
    categoryName: 'Cuidado emocional',
    categorySlug: 'cuidado-emocional',
    title: 'Infografía: Momentos de pausa y respiración',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 2,
    description: 'Técnica de respiración consciente en 4 tiempos para momentos de inquietud.',
    textoAccesible:
      'Técnica de respiración consciente en 4 tiempos:\n\n' +
      '1. INHALAR: Tomar aire lentamente por la nariz durante 4 segundos sintiendo cómo se expande el abdomen.\n' +
      '2. PAUSA: Mantener el aire suavemente durante 2 segundos.\n' +
      '3. EXHALAR: Soltar el aire de manera prolongada por la boca durante 4 segundos.\n' +
      '4. REPOSO: Esperar 2 segundos antes de la siguiente respiración. Repetir 4 a 5 ciclos en una posición cómoda.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-bienestar-emocional',
    category: 4,
    categoryName: 'Cuidado emocional',
    categorySlug: 'cuidado-emocional',
    title: 'Video: Reconocer y compartir emociones',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 5,
    description: 'Orientación para conversar sobre los estados de ánimo con personas de confianza.',
    youtubeVideoId: 'dQw4w9WgXcQ',
  },

  // Categoría 5: Sexualidad y salud reproductiva
  {
    id: 'edu-infografia-salud-sexual',
    category: 5,
    categoryName: 'Sexualidad y salud reproductiva',
    categorySlug: 'sexualidad-reproductiva',
    title: 'Infografía: Cuidados generales de salud sexual',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 2,
    description: 'Orientaciones generales de protección, cuidado de mucosas y comunicación.',
    textoAccesible:
      'Orientaciones generales de salud íntima durante el tratamiento:\n\n' +
      '• MEDIDAS DE BARRERA: El uso de métodos de barrera es recomendado durante el periodo de tratamiento según indicación médica.\n' +
      '• HIDRATACIÓN: Cuidar la piel y mucosas con productos neutros y sin fragancias indicados por el especialista.\n' +
      '• DIÁLOGO: Comunicar al equipo médico cualquier molestia o duda específica para recibir orientación personalizada.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-salud-intima',
    category: 5,
    categoryName: 'Sexualidad y salud reproductiva',
    categorySlug: 'sexualidad-reproductiva',
    title: 'Video: Dudas frecuentes en la consulta médica',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 4,
    description: 'Preguntas habituales sobre bienestar íntimo y tiempos de consulta.',
    youtubeVideoId: 'psfP_n8eP40',
  },

  // Categoría 6: Vida cotidiana y relaciones
  {
    id: 'edu-infografia-rutina-hogar',
    category: 6,
    categoryName: 'Vida cotidiana y relaciones',
    categorySlug: 'vida-cotidiana',
    title: 'Infografía: Organización del hogar y visitas',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 2,
    description: 'Pautas para organizar las tareas domésticas y acordar visitas breves.',
    textoAccesible:
      'Organización de la vida cotidiana en el hogar:\n\n' +
      '• DELEGAR TAREAS: Distribuir compras y tareas pesadas entre familiares o amigos de confianza.\n' +
      '• VISITAS TRANQUILAS: Sugerir visitas cortas en horarios en que el paciente se sienta con mejor energía.\n' +
      '• ESPACIOS PERSONALES: Respetar momentos de descanso sin compromisos sociales cuando el cuerpo lo pida.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-adaptar-rutina',
    category: 6,
    categoryName: 'Vida cotidiana y relaciones',
    categorySlug: 'vida-cotidiana',
    title: 'Video: Planificar tu semana tras el ciclo',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 5,
    description:
      'Cómo priorizar actividades y tiempos de descanso en los días posteriores a la sesión.',
    youtubeVideoId: 'psfP_n8eP40',
  },

  // Categoría 7: Red de apoyo y recursos
  {
    id: 'edu-infografia-contactos-clave',
    category: 7,
    categoryName: 'Red de apoyo y recursos',
    categorySlug: 'red-apoyo',
    title: 'Infografía: Tu red de apoyo y contactos clave',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 2,
    description: 'Esquema para organizar teléfonos de contacto, traslados y cuidadores.',
    textoAccesible:
      'Organización de la red de apoyo personal:\n\n' +
      '• TELÉFONOS DE CONTACTO: Registrar en un lugar visible el número del centro médico y del servicio de urgencia más cercano.\n' +
      '• TRASLADOS: Coordinar con anticipación quién acompañará al paciente en viajes de ida y vuelta a la sesión.\n' +
      '• CUADERNILLO O APP: Anotar dudas que surjan en el día a día para revisarlas en el próximo control médico.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-comunicacion-familiar',
    category: 7,
    categoryName: 'Red de apoyo y recursos',
    categorySlug: 'red-apoyo',
    title: 'Video: Coordinarse con cuidadores y seres queridos',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 5,
    description: 'Estrategias para compartir la información de salud sin sobrecargas individuales.',
    youtubeVideoId: 'dQw4w9WgXcQ',
  },

  // Categoría 8: Preguntas frecuentes
  {
    id: 'edu-infografia-faq-quimio',
    category: 8,
    categoryName: 'Preguntas frecuentes',
    categorySlug: 'preguntas-frecuentes',
    title: 'Infografía: Respuestas a dudas habituales',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 3,
    description: 'Información práctica sobre tiempos de espera, ropa cómoda y compañía.',
    textoAccesible:
      'Preguntas habituales sobre las sesiones de quimioterapia:\n\n' +
      '• ¿CUÁNTO TIEMPO DURA LA SESIÓN?: El tiempo varía según el esquema indicado por el oncólogo; consultar la duración estimada antes del día de la cita.\n' +
      '• ¿QUÉ ROPA ES RECOMENDABLE?: Vestir prendas holgadas con mangas fáciles de remangar o escote cómodo si se usa catéter.\n' +
      '• ¿PUEDO IR ACOMPAÑADO?: La mayoría de centros permite un acompañante adulto en salas de espera o según las normas internas del servicio.\n' +
      '• ¿QUÉ LLEVAR AL CENTRO?: Documento de identidad, carnet de citación médica, lista de medicamentos habituales y algo para entretenerse (libro o música).',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-faq-equipo',
    category: 8,
    categoryName: 'Preguntas frecuentes',
    categorySlug: 'preguntas-frecuentes',
    title: 'Video: Profesionales aclaran dudas frecuentes',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 5,
    description:
      'Respuestas a preguntas habituales realizadas por pacientes antes de comenzar su primer ciclo.',
    youtubeVideoId: 'psfP_n8eP40',
  },
] as const;
