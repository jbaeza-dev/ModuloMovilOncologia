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
    contentMarkdown: `# Prepararse para una sesión de quimioterapia\n\n## Recomendaciones para el día de infusión\n\n1. **Alimentación previa**: Consume una comida liviana 1 a 2 horas antes de tu sesión (galletas de agua, té o tostadas). Evita alimentos muy condimentados o grasos.\n2. **Vestimenta**: Usa ropa cómoda, holgada y preferentemente con mangas fáciles de arremangar para facilitar el acceso venoso.\n3. **Hidratación**: Bebe abundante agua el día anterior y la mañana de la sesión para proteger la función renal.\n4. **Acompañamiento**: Es recomendable asistir con un familiar o persona de confianza.\n5. **Documentación**: Lleva tu cédula de identidad, carnet de citas y exámenes recientes solicitados por tu equipo médico.`,
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
    contentMarkdown: `# Cuidados en el hogar post-quimioterapia\n\n## Primeros días de recuperación\n\n- **Descanso reparador**: Alterna períodos de actividad suave con reposo. No te sobreexijas durante las primeras 48 horas.\n- **Higiene bucal**: Usa un cepillo de cerdas suaves y enjuagues sin alcohol para prevenir la aparición de llagas o mucositis.\n- **Control de temperatura**: Mide tu temperatura dos veces al día. Si presentas 38.0°C o más de forma sostenida, comunícate de inmediato con tu centro asistencial.\n- **Alimentación fraccionada**: Es preferible comer porciones pequeñas 5 a 6 veces al día para controlar las náuseas.`,
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
    contentMarkdown: `# Preguntas frecuentes sobre el acompañamiento\n\n### ¿Cuánto dura una sesión típica?\nDepende del esquema indicado por el oncólogo. Las infusiones pueden variar entre 2 y 6 horas según los fármacos a administrar y la premedicación.\n\n### ¿Puedo tomar mis medicamentos habituales?\nConsulta siempre con tu oncólogo o enfermera antes de tomar medicamentos para la presión, diabetes u otros tratamientos crónicos el día de la sesión.\n\n### ¿Qué hacer si siento náuseas?\nToma los antieméticos recetados según el horario indicado por tu médico, sin esperar a que el malestar aumente.`,
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
    contentMarkdown: `# Organizar tus consultas médicas\n\nLlevar un registro ordenado te ayudará a aprovechar al máximo cada visita médica:\n\n- **Anota los síntomas**: Registra el día, la hora y la intensidad cuando aparezcan molestias.\n- **Preguntas prioritarias**: Escribe las 3 dudas principales antes de entrar a la consulta.\n- **Efectos secundarios**: Informa sobre cualquier cambio en el apetito, sueño o digestión.`,
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
    contentMarkdown: `# Rutina diaria y adaptación\n\n- **Planificación por prioridades**: Realiza las tareas más importantes en los momentos del día con mayor energía.\n- **Pausas activas**: Levántate y estira suavemente los músculos cada 45 minutos si pasas tiempo sentado.\n- **Evita esfuerzos pesados**: No levantes objetos pesados ni realices ejercicios de alto impacto sin autorización de tu médico.`,
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
    contentMarkdown: `# Descanso y bienestar emocional\n\n- **Ambiente propicio**: Mantén tu habitación fresca, oscura y silenciosa durante la noche.\n- **Horarios regulares**: Intenta acostarte y levantarte a la misma hora.\n- **Momentos de calma**: Dedica 15 minutos al día a respiración profunda, música relajante o lectura tranquila.`,
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
    contentMarkdown: `# Red de apoyo y comunicación\n\n- **Expresa tus necesidades**: Comunica claramente a tu familia cómo te sientes y en qué tareas requieres ayuda.\n- **Delegar con confianza**: Permite que tus seres queridos colaboren en compras, cocina o traslados.\n- **Espacios para compartir**: Mantener conversaciones sobre temas no relacionados con la enfermedad fortalece los lazos afectivos.`,
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
    contentMarkdown: `# Pautas de alimentación diaria\n\n- **Hidratación constante**: Bebe al menos 1.5 a 2 litros de agua diarios, preferentemente fuera de las comidas principales.\n- **Proteínas de calidad**: Incluye huevos, pollo, legumbres o pescados bien cocidos para conservar la masa muscular.\n- **Porciones pequeñas**: Fracciona tu alimentación en 5 tomas ligeras a lo largo del día para facilitar la digestión.`,
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
    contentMarkdown: `# Bienestar físico y emocional\n\n- **Paseos al aire libre**: Una caminata suave de 15 minutos en horas no soleadas mejora la oxigenación y el ánimo.\n- **Protección solar**: La piel puede estar más sensible; usa bloqueador solar FPS 50+ y sombrero.\n- **Escucha a tu cuerpo**: Respeta tus tiempos de descanso sin culpabilidad. Cada ciclo de recuperación es un avance.`,
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
