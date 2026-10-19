import type Feather from '@expo/vector-icons/Feather';
import type { EducationalResource } from '../../data/local/education/education-types';
import {
  EDUCATIONAL_CATEGORIES,
  type EducationalCategoryDefinition,
} from './educational-categories';
import { SAMPLE_EDUCATIONAL_CATALOG } from './sample-education-catalog';

export interface EducationalCategory {
  id: number;
  slug?: string;
  title: string;
  icon: keyof typeof Feather.glyphMap;
  description?: string;
  count: number;
  countLabel: string;
}

export type EducationalFormatFilter = 'all' | 'video' | 'infografia';

export interface EducationalCatalogReader {
  getCategories(): Promise<EducationalCategory[]>;
  getResourcesByCategory(
    categoryId: number,
    formatFilter?: EducationalFormatFilter,
  ): Promise<EducationalResource[]>;
  getResourceById(resourceId: string): Promise<EducationalResource | null>;
  getAllResources(formatFilter?: EducationalFormatFilter): Promise<EducationalResource[]>;
}

export class InMemoryEducationalCatalogReader implements EducationalCatalogReader {
  private resources: readonly EducationalResource[];

  constructor(resources: readonly EducationalResource[] = SAMPLE_EDUCATIONAL_CATALOG) {
    this.resources = resources;
  }

  async getCategories(): Promise<EducationalCategory[]> {
    return EDUCATIONAL_CATEGORIES.map((def: EducationalCategoryDefinition) => {
      const matchingCount = this.resources.filter((r) => r.category === def.id).length;
      return {
        id: def.id,
        slug: def.slug,
        title: def.title,
        icon: def.icon,
        description: def.description,
        count: matchingCount,
        countLabel: `${matchingCount} contenido${matchingCount === 1 ? '' : 's'}`,
      };
    });
  }

  async getResourcesByCategory(
    categoryId: number,
    formatFilter: EducationalFormatFilter = 'all',
  ): Promise<EducationalResource[]> {
    return this.resources.filter((r) => {
      if (r.category !== categoryId) return false;
      if (formatFilter === 'all') return true;
      return r.type === formatFilter;
    });
  }

  async getResourceById(resourceId: string): Promise<EducationalResource | null> {
    const found = this.resources.find((r) => r.id === resourceId);
    return found ?? null;
  }

  async getAllResources(
    formatFilter: EducationalFormatFilter = 'all',
  ): Promise<EducationalResource[]> {
    if (formatFilter === 'all') return [...this.resources];
    return this.resources.filter((r) => r.type === formatFilter);
  }
}

let activeCatalogReader: EducationalCatalogReader = new InMemoryEducationalCatalogReader();

export function getEducationalCatalogReader(): EducationalCatalogReader {
  return activeCatalogReader;
}

export function setEducationalCatalogReader(reader: EducationalCatalogReader): void {
  activeCatalogReader = reader;
}
