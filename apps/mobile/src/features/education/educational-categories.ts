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
    slug: 'unidad-oncologica',
    title: 'Conociendo la Unidad Oncológica',
    icon: 'map-pin',
    description: 'Instalaciones, equipo de atención y orientación al ingresar a la unidad.',
  },
  {
    id: 1,
    slug: 'conociendo-cancer',
    title: 'Conociendo el cáncer',
    icon: 'activity',
    description: 'Conceptos generales sobre la enfermedad, diagnóstico y etapas.',
  },
  {
    id: 2,
    slug: 'conociendo-quimioterapia',
    title: 'Conociendo la quimioterapia',
    icon: 'clipboard',
    description: 'Cómo funciona el tratamiento, ciclos y cuidados generales.',
  },
  {
    id: 3,
    slug: 'dispositivos-tratamiento',
    title: 'Dispositivos de tratamiento',
    icon: 'disc',
    description: 'Catéteres, reservorios y cuidados de accesos vasculares.',
  },
  {
    id: 4,
    slug: 'efectos-secundarios',
    title: 'Efectos secundarios',
    icon: 'alert-triangle',
    description: 'Prevención y manejo de molestias esperadas durante la quimioterapia.',
  },
  {
    id: 5,
    slug: 'salud-mental',
    title: 'Salud mental',
    icon: 'smile',
    description: 'Apoyo emocional, manejo de la ansiedad y acompañamiento psicológico.',
  },
  {
    id: 6,
    slug: 'alimentacion',
    title: 'Alimentación',
    icon: 'coffee',
    description:
      'Recomendaciones nutricionales, hidratación e higiene de alimentos en tratamiento.',
  },
  {
    id: 7,
    slug: 'signos-alarma',
    title: 'Signos de alarma',
    icon: 'alert-circle',
    description: 'Síntomas y señales que requieren consulta médica urgente o inmediata.',
  },
  {
    id: 8,
    slug: 'gestoras-procesos',
    title: 'Gestoras de casos',
    icon: 'users',
    description: 'Acompañamiento, coordinación de horas médicas y orientación de trámites.',
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
