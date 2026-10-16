import type { EducationalResource } from '../../data/local/education/education-types';

export interface EducationalCategoryItem {
  id: number;
  title: string;
  icon: 'book-open' | 'sun' | 'coffee' | 'video' | 'image';
  count: string;
}

export const SAMPLE_EDUCATIONAL_CATEGORIES: readonly EducationalCategoryItem[] = [
  { id: 0, title: 'Preparación', icon: 'book-open', count: '4 contenidos' },
  { id: 1, title: 'Vida cotidiana', icon: 'sun', count: '4 contenidos' },
  { id: 2, title: 'Nutrición y bienestar', icon: 'coffee', count: '3 contenidos' },
] as const;

export const SAMPLE_EDUCATIONAL_CATALOG: readonly EducationalResource[] = [
  // Categoría 0: Preparación
  {
    id: 'edu-prep-sesion',
    category: 0,
    categoryName: 'Preparación',
    title: 'Prepararse para una sesión',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 3,
    description: 'Recomendaciones básicas para asistir a la infusión de quimioterapia.',
    contentMarkdown: `# Prepararse para una sesión\n\nEste texto es material de muestra neutro para la demostración técnica del guardado y lectura de archivos sin conexión en el dispositivo móvil.\n\nNo contiene indicaciones médicas, umbrales clínicos ni recomendaciones de tratamiento, los cuales serán incorporados tras la correspondiente validación clínica del equipo de salud.`,
  },
  {
    id: 'edu-cuidados-casa',
    category: 0,
    categoryName: 'Preparación',
    title: 'Cuidados en casa',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 4,
    description: 'Pautas de higiene, reposo y convivencia durante los primeros días.',
    contentMarkdown: `# Cuidados en el hogar\n\nMaterial de demostración técnica para validar la persistencia local de recursos educativos.\n\nEste contenido es un texto de prueba neutro para comprobar el almacenamiento físico del archivo en el teléfono y su posterior visualización sin red.`,
  },
  {
    id: 'edu-preguntas-frecuentes',
    category: 0,
    categoryName: 'Preparación',
    title: 'Preguntas frecuentes',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 5,
    description: 'Respuestas a dudas habituales sobre tiempos de espera y compañía.',
    contentMarkdown: `# Preguntas frecuentes sobre el acompañamiento\n\nTexto de muestra utilizado exclusivamente para validar el aislamiento de archivos por paciente y la lectura local sin conexión en QuimioCare.`,
  },
  {
    id: 'edu-video-induccion',
    category: 0,
    categoryName: 'Preparación',
    title: 'Video: Conoce tu proceso de tratamiento',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 6,
    description: 'Orientación en video sobre la sala de infusión y acompañamiento médico.',
    youtubeVideoId: 'psfP_n8eP40',
  },

  // Categoría 1: Vida cotidiana
  {
    id: 'edu-organizar-preguntas',
    category: 1,
    categoryName: 'Vida cotidiana',
    title: 'Organizar tus preguntas',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 3,
    description: 'Cómo registrar síntomas y dudas para la consulta oncológica.',
    contentMarkdown: `# Organizar tus consultas\n\nDocumento de prueba técnica para verificar que el almacenamiento de copias locales funciona de manera aislada por paciente en el dispositivo.`,
  },
  {
    id: 'edu-rutina-cotidiana',
    category: 1,
    categoryName: 'Vida cotidiana',
    title: 'Rutina cotidiana',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 3,
    description: 'Adaptación de actividades habituales y pausas recomendadas.',
    contentMarkdown: `# Rutina diaria de ejemplo\n\nMaterial de prueba sin recomendaciones clínicas para la verificación de almacenamiento y borrado físico de archivos.`,
  },
  {
    id: 'edu-descanso-acompanamiento',
    category: 1,
    categoryName: 'Vida cotidiana',
    title: 'Descanso y acompañamiento',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 4,
    description: 'Higiene del sueño y espacios de tranquilidad durante el ciclo.',
    contentMarkdown: `# Descanso y bienestar\n\nTexto demostrativo para la evaluación técnica del módulo móvil.`,
  },
  {
    id: 'edu-apoyo-familiar',
    category: 1,
    categoryName: 'Vida cotidiana',
    title: 'Apoyo familiar',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 3,
    description: 'Pautas de comunicación con familiares y cuidadores primarios.',
    contentMarkdown: `# Red de apoyo y acompañamiento\n\nDocumento neutral para pruebas de lectura fuera de línea.`,
  },

  // Categoría 2: Nutrición y bienestar
  {
    id: 'edu-alimentacion-diaria',
    category: 2,
    categoryName: 'Nutrición y bienestar',
    title: 'Alimentación diaria',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 4,
    description: 'Consejos generales de hidratación y tolerancia a alimentos.',
    contentMarkdown: `# Información sobre alimentación\n\nTexto de prueba técnica. El contenido clínico definitivo será suministrado por el equipo tratante en futuras etapas del proyecto.`,
  },
  {
    id: 'edu-bienestar-general',
    category: 2,
    categoryName: 'Nutrición y bienestar',
    title: 'Bienestar general',
    type: 'guia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 4,
    description: 'Paseos ligeros, respiración y cuidado del estado de ánimo.',
    contentMarkdown: `# Bienestar y seguimiento\n\nMaterial de demostración técnica para la persistencia SQLite en QuimioCare.`,
  },
  {
    id: 'edu-infografia-alimentacion',
    category: 2,
    categoryName: 'Nutrición y bienestar',
    title: 'Infografía: Guía nutricional en quimioterapia',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 2,
    description: 'Póster ilustrado con 3 pilares: hidratación, porciones y cocción segura.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
] as const;
