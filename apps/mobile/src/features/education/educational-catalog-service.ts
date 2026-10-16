import type { EducationalResource } from '../../data/local/education/education-types';
import { SAMPLE_EDUCATIONAL_CATALOG } from './sample-education-catalog';

export interface EducationalCategory {
  id: number;
  title: string;
  icon: 'book-open' | 'sun' | 'coffee' | 'video' | 'image';
  count: number;
  countLabel: string;
}

export interface EducationalCatalogReader {
  getCategories(): Promise<EducationalCategory[]>;
  getResourcesByCategory(categoryId: number): Promise<EducationalResource[]>;
  getResourceById(resourceId: string): Promise<EducationalResource | null>;
  getAllResources(): Promise<EducationalResource[]>;
}

const CATEGORY_DEFINITIONS: ReadonlyArray<Omit<EducationalCategory, 'count' | 'countLabel'>> = [
  { id: 0, title: 'Preparación', icon: 'book-open' },
  { id: 1, title: 'Vida cotidiana', icon: 'sun' },
  { id: 2, title: 'Nutrición y bienestar', icon: 'coffee' },
];

export class InMemoryEducationalCatalogReader implements EducationalCatalogReader {
  private resources: readonly EducationalResource[];

  constructor(resources: readonly EducationalResource[] = SAMPLE_EDUCATIONAL_CATALOG) {
    this.resources = resources;
  }

  async getCategories(): Promise<EducationalCategory[]> {
    return CATEGORY_DEFINITIONS.map((def) => {
      const matchingCount = this.resources.filter((r) => r.category === def.id).length;
      return {
        ...def,
        count: matchingCount,
        countLabel: `${matchingCount} contenido${matchingCount === 1 ? '' : 's'}`,
      };
    });
  }

  async getResourcesByCategory(categoryId: number): Promise<EducationalResource[]> {
    return this.resources.filter((r) => r.category === categoryId);
  }

  async getResourceById(resourceId: string): Promise<EducationalResource | null> {
    const found = this.resources.find((r) => r.id === resourceId);
    return found ?? null;
  }

  async getAllResources(): Promise<EducationalResource[]> {
    return [...this.resources];
  }
}

let activeCatalogReader: EducationalCatalogReader = new InMemoryEducationalCatalogReader();

export function getEducationalCatalogReader(): EducationalCatalogReader {
  return activeCatalogReader;
}

export function setEducationalCatalogReader(reader: EducationalCatalogReader): void {
  activeCatalogReader = reader;
}
