import { isUuid } from '../../services/session/response-checks';
import { canonical } from './clinical-command';

export interface PublishedEducation extends Record<string, unknown> {
  id: string;
  titulo: string;
  descripcion: string;
  tipo: 'imagen' | 'video';
  url: string;
  categoria: string;
  activo: true;
  fecha_creacion: string;
  archivo_mime: 'image/png' | 'image/jpeg' | null;
  archivo_tamano_bytes: number | null;
  archivo_revision: string | null;
  archivo_sha256: string | null;
}

/** Same eligibility as C11–C13 and the server-controlled replication projection. */
export function eligibleEducation(rows: readonly Record<string, unknown>[]): PublishedEducation[] {
  const byId = new Map<string, PublishedEducation>();
  for (const row of rows) {
    if (
      !(row.activo === true || row.activo === 1) ||
      typeof row.categoria !== 'string' ||
      !row.categoria.trim() ||
      typeof row.url !== 'string' ||
      !row.url.trim() ||
      !['imagen', 'video'].includes(String(row.tipo))
    )
      continue;
    if (
      row.tipo === 'imagen' &&
      (!['image/png', 'image/jpeg'].includes(String(row.archivo_mime)) ||
        !Number.isSafeInteger(row.archivo_tamano_bytes) ||
        Number(row.archivo_tamano_bytes) <= 0 ||
        !isUuid(row.archivo_revision) ||
        !/^[0-9a-f]{64}$/.test(String(row.archivo_sha256)))
    )
      continue;
    if (
      row.tipo === 'video' &&
      ['archivo_mime', 'archivo_tamano_bytes', 'archivo_revision', 'archivo_sha256'].some(
        (key) => row[key] !== null,
      )
    )
      continue;
    if (
      !isUuid(row.id) ||
      typeof row.titulo !== 'string' ||
      typeof row.fecha_creacion !== 'string' ||
      !Number.isFinite(Date.parse(row.fecha_creacion)) ||
      !(row.descripcion === null || typeof row.descripcion === 'string')
    )
      throw new Error('El contenido educativo publicado está incompleto.');
    const normalized = {
      ...row,
      activo: true,
      descripcion: row.descripcion ?? '',
    } as PublishedEducation;
    const old = byId.get(normalized.id);
    if (old && canonical(old) !== canonical(normalized))
      throw new Error('El catálogo contiene versiones contradictorias del mismo recurso.');
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(b.fecha_creacion) - Date.parse(a.fecha_creacion) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function selectEducation(
  rows: readonly Record<string, unknown>[],
  query: {
    category?: string;
    type?: 'imagen' | 'video';
    q?: string;
    limit?: number;
    skip?: number;
  } = {},
) {
  const eligible = eligibleEducation(rows);
  const filtered = eligible.filter(
    (row) =>
      (query.category === undefined || row.categoria === query.category) &&
      (query.type === undefined || row.tipo === query.type) &&
      (query.q === undefined ||
        (row.titulo + ' ' + row.descripcion).toLowerCase().includes(query.q.toLowerCase())),
  );
  const limit = query.limit ?? 20,
    skip = query.skip ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(skip) || skip < 0)
    throw new Error('Paginación educativa inválida.');
  return {
    total: filtered.length,
    contenidos: filtered.slice(skip, skip + limit),
    categorias: [...new Set(eligible.map((row) => row.categoria))].sort(),
  };
}

/** Text may change independently. Immutable byte revision includes transport and byte metadata. */
export function assertEducationRevisions(
  previous: readonly Record<string, unknown>[],
  next: readonly PublishedEducation[],
) {
  const old = new Map(previous.map((row) => [row.id, row]));
  for (const row of next) {
    const before = old.get(row.id);
    if (!before || before.tipo !== 'imagen' || row.tipo !== 'imagen') continue;
    const metadata = ['url', 'archivo_mime', 'archivo_tamano_bytes', 'archivo_sha256'];
    if (
      before.archivo_revision === row.archivo_revision &&
      metadata.some((key) => before[key] !== row[key])
    )
      throw new Error('La revisión de la imagen cambió sin una nueva publicación de bytes.');
    if (
      before.archivo_sha256 !== row.archivo_sha256 &&
      (before.url === row.url || before.archivo_revision === row.archivo_revision)
    )
      throw new Error('Los bytes reemplazados necesitan URL y revisión nuevas.');
  }
}
