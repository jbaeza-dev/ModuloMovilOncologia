import type { EducationalResource } from '../../data/local/education/education-types';
import { EDUCATIONAL_CATEGORIES } from './educational-categories';

export interface EducationalCategoryItem {
  id: number;
  slug: string;
  title: string;
  icon: string;
  count: string;
}

export const SAMPLE_EDUCATIONAL_CATALOG: readonly EducationalResource[] = [
  // Categoría 2: Conociendo la quimioterapia
  {
    id: 'edu-video-induccion',
    category: 2,
    categoryName: 'Conociendo la quimioterapia',
    categorySlug: 'conociendo-quimioterapia',
    title: 'Video: Conoce tu proceso de tratamiento',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 6,
    description: 'Orientación en video sobre la sala de infusión y acompañamiento médico.',
    youtubeVideoId: 'psfP_n8eP40',
  },

  // Categoría 4: Efectos secundarios
  {
    id: 'edu-video-alivio-sintomas',
    category: 4,
    categoryName: 'Efectos secundarios',
    categorySlug: 'efectos-secundarios',
    title: 'Video: Consejos prácticos ante molestias frecuentes',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 5,
    description: 'Técnicas sencillas de respiración y descanso tras la infusión.',
    youtubeVideoId: 'dQw4w9WgXcQ',
  },

  // Categoría 5: Salud mental
  {
    id: 'edu-video-bienestar-emocional',
    category: 5,
    categoryName: 'Salud mental',
    categorySlug: 'salud-mental',
    title: 'Video: Reconocer y compartir emociones',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 5,
    description: 'Orientación para conversar sobre los estados de ánimo con personas de confianza.',
    youtubeVideoId: 'dQw4w9WgXcQ',
  },

  // Categoría 6: Alimentación
  {
    id: 'edu-infografia-alimentacion',
    category: 6,
    categoryName: 'Alimentación',
    categorySlug: 'alimentacion',
    title: 'Infografía: Guía nutricional en quimioterapia',
    type: 'infografia',
    version: '1.0.0',
    estimatedReadTimeMinutes: 3,
    description:
      'Pautas de hidratación constante, porciones pequeñas y frecuentes, e higiene alimentaria estricta.',
    textoAccesible:
      'Guía Nutricional en Quimioterapia. Información médica fiable.\n\n' +
      '1. HIDRATACIÓN CONSTANTE:\n' +
      '• Beber abundantes líquidos (agua, infusiones, caldos).\n' +
      '• Pequeños sorbos a lo largo del día.\n' +
      '• Evitar deshidratación.\n' +
      '• Consultar sobre bebidas recomendadas.\n\n' +
      '2. PORCIONES PEQUEÑAS Y FRECUENTES:\n' +
      '• Comer menos cantidad, pero más a menudo (5-6 veces al día).\n' +
      '• Alimentos suaves y fáciles de digerir.\n' +
      '• Texturas agradables al paladar.\n' +
      '• Priorizar alimentos ricos en nutrientes.\n\n' +
      '3. HIGIENE ALIMENTARIA ESTRICTA:\n' +
      '• Lavar frutas y verduras minuciosamente.\n' +
      '• Cocinar bien los alimentos (carnes, huevos, pescados).\n' +
      '• Mantener limpieza en la cocina y utensilios.\n' +
      '• Refrigerar alimentos cocinados rápidamente.\n' +
      '• Evitar contaminación cruzada.',
    asset: {
      type: 'bundled',
      assetKey: 'infografia_alimentacion_quimio',
      extension: 'png',
      mimeType: 'image/png',
    },
  },
  {
    id: 'edu-video-hidratacion-facil',
    category: 6,
    categoryName: 'Alimentación',
    categorySlug: 'alimentacion',
    title: 'Video: Opciones de líquidos e hidratación diaria',
    type: 'video',
    version: '1.0.0',
    estimatedReadTimeMinutes: 4,
    description: 'Ideas de caldos tibios e infusiones suaves durante los ciclos.',
    youtubeVideoId: 'psfP_n8eP40',
  },
] as const;

export const SAMPLE_EDUCATIONAL_CATEGORIES: readonly EducationalCategoryItem[] =
  EDUCATIONAL_CATEGORIES.map((c) => {
    const count = SAMPLE_EDUCATIONAL_CATALOG.filter((item) => item.categorySlug === c.slug).length;
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      icon: c.icon,
      count: count === 0 ? '0 contenidos' : count === 1 ? '1 contenido' : `${count} contenidos`,
    };
  });
