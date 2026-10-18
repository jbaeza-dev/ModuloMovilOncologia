import Feather from '@expo/vector-icons/Feather';

export interface EducationalCategoryDefinition {
  id: number;
  slug: string;
  title: string;
  icon: keyof typeof Feather.glyphMap;
  description: string;
}

/**
 * Las 9 categorías clínicas acordadas para el módulo educativo de QuimioCare.
 */
export const EDUCATIONAL_CATEGORIES: readonly EducationalCategoryDefinition[] = [
  {
    id: 0,
    slug: 'proceso-quimioterapia',
    title: 'Proceso de quimioterapia',
    icon: 'clipboard',
    description: 'Etapas del tratamiento, sala de infusión y controles de ciclo.',
  },
  {
    id: 1,
    slug: 'manejo-sintomas',
    title: 'Manejo de síntomas',
    icon: 'alert-circle',
    description: 'Monitoreo de temperatura, náuseas, dolor y señales de alerta.',
  },
  {
    id: 2,
    slug: 'nutricion-hidratacion',
    title: 'Nutrición e hidratación',
    icon: 'coffee',
    description: 'Ingesta de líquidos, alimentación balanceada e higiene alimentaria.',
  },
  {
    id: 3,
    slug: 'actividad-descanso',
    title: 'Actividad física y descanso',
    icon: 'moon',
    description: 'Higiene del sueño, pausas diarias y movilidad suave adaptada.',
  },
  {
    id: 4,
    slug: 'cuidado-emocional',
    title: 'Cuidado emocional',
    icon: 'smile',
    description: 'Estrategias de calma, respiración y expresión de estados de ánimo.',
  },
  {
    id: 5,
    slug: 'sexualidad-reproductiva',
    title: 'Sexualidad y salud reproductiva',
    icon: 'users',
    description: 'Cuidados íntimos, medidas de protección y diálogo con el equipo tratante.',
  },
  {
    id: 6,
    slug: 'vida-cotidiana',
    title: 'Vida cotidiana y relaciones',
    icon: 'home',
    description: 'Organización doméstica, adaptación de horarios y convivencia.',
  },
  {
    id: 7,
    slug: 'red-apoyo',
    title: 'Red de apoyo y recursos',
    icon: 'phone',
    description: 'Canales de contacto, coordinación familiar y cuidadores.',
  },
  {
    id: 8,
    slug: 'preguntas-frecuentes',
    title: 'Preguntas frecuentes',
    icon: 'help-circle',
    description: 'Dudas habituales sobre acompañamiento, traslados y citas médicas.',
  },
] as const;

export function getCategoryByIdOrSlug(
  identifier: number | string | undefined | null,
): EducationalCategoryDefinition {
  if (identifier === undefined || identifier === null) {
    return EDUCATIONAL_CATEGORIES[0];
  }

  if (typeof identifier === 'number') {
    const found = EDUCATIONAL_CATEGORIES.find((c) => c.id === identifier);
    return found ?? EDUCATIONAL_CATEGORIES[0];
  }

  const num = Number(identifier);
  if (!Number.isNaN(num) && num >= 0 && num < EDUCATIONAL_CATEGORIES.length) {
    const found = EDUCATIONAL_CATEGORIES.find((c) => c.id === num);
    if (found) return found;
  }

  const bySlug = EDUCATIONAL_CATEGORIES.find((c) => c.slug === identifier);
  return bySlug ?? EDUCATIONAL_CATEGORIES[0];
}

export function getCategoryTitle(categoryId: number): string {
  const cat = EDUCATIONAL_CATEGORIES.find((c) => c.id === categoryId);
  return cat ? cat.title : 'Contenido educativo';
}
