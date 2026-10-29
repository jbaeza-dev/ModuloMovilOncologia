import type { createCatalogRepository } from '../../data/sync/catalog-repository';
import { eligibleEducation } from '../../data/sync/education-catalog';
import type { EducationalResource } from '../../data/local/education/education-types';
import type {
  EducationalCatalogReader,
  EducationalFormatFilter,
} from './educational-catalog-service';

// Stable across category additions/removals. A collision fails instead of merging categories.
function categoryId(text: string) {
  let hash = 2166136261;
  for (const c of text) {
    hash ^= c.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function youtubeId(url: string) {
  try {
    const parsed = new URL(url),
      host = parsed.hostname.toLowerCase();
    const id =
      host === 'youtu.be'
        ? parsed.pathname.slice(1)
        : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
          ? parsed.pathname === '/watch'
            ? parsed.searchParams.get('v')
            : parsed.pathname.split('/')[2]
          : null;
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
export function createReplicatedEducationReader(
  catalog: Pick<ReturnType<typeof createCatalogRepository>, 'status' | 'education'>,
): EducationalCatalogReader {
  async function all(): Promise<EducationalResource[]> {
    const status = await catalog.status();
    if (!status?.completed_at)
      throw new Error('Aún no se ha recibido un catálogo educativo completo.');
    const rows = eligibleEducation(await catalog.education());
    const categories = new Map<number, string>();
    return rows.map((row) => {
      const id = categoryId(row.categoria),
        old = categories.get(id);
      if (old !== undefined && old !== row.categoria)
        throw new Error('Identidad de categoría ambigua.');
      categories.set(id, row.categoria);
      return {
        id: row.id,
        title: row.titulo,
        description: row.descripcion,
        category: id,
        categoryName: row.categoria,
        categorySlug: 'categoria:' + row.categoria,
        type: row.tipo === 'imagen' ? 'infografia' : 'video',
        version: row.archivo_revision ?? row.fecha_creacion,
        textoAccesible: row.descripcion.trim() || undefined,
        ...(row.tipo === 'imagen'
          ? {
              asset: {
                type: 'remote' as const,
                url: row.url,
                extension: row.archivo_mime === 'image/png' ? ('png' as const) : ('jpeg' as const),
                mimeType: row.archivo_mime!,
                expectedBytes: row.archivo_tamano_bytes!,
                expectedSha256: row.archivo_sha256!,
                revision: row.archivo_revision!,
              },
            }
          : { youtubeVideoId: youtubeId(row.url), videoUrl: row.url }),
      };
    });
  }
  const filtered = (rows: EducationalResource[], format: EducationalFormatFilter = 'all') =>
    rows.filter((row) => format === 'all' || row.type === format);
  return {
    async getCategories() {
      const resources = await all(),
        categories = new Map<number, EducationalResource>();
      for (const row of resources) categories.set(row.category, row);
      return [...categories.values()].map((row) => {
        const count = resources.filter((item) => item.category === row.category).length;
        return {
          id: row.category,
          slug: row.categorySlug,
          title: row.categoryName,
          icon: 'book-open' as const,
          count,
          countLabel: `${count} contenido${count === 1 ? '' : 's'}`,
        };
      });
    },
    async getAllResources(format) {
      return filtered(await all(), format);
    },
    async getResourcesByCategory(id, format) {
      return filtered(await all(), format).filter((row) => row.category === id);
    },
    async getResourceById(id) {
      return (await all()).find((row) => row.id === id) ?? null;
    },
  };
}
