import type { Database } from './db.js';
import { ApiError } from './errors.js';
import type { ObjectValue } from './types.js';

// Must match the server-controlled PowerSync eligibility projection, never REST/RLS inheritance.
const ELIGIBLE = `activo=true AND categoria_habilitada=true AND categoria IS NOT NULL AND categoria ~ '[^[:space:]]'
  AND url IS NOT NULL AND url ~ '[^[:space:]]' AND (
  (tipo='imagen' AND archivo_mime IN ('image/png','image/jpeg') AND archivo_tamano_bytes>0
    AND archivo_revision IS NOT NULL AND archivo_sha256 ~ '^[0-9a-f]{64}$')
  OR (tipo='video' AND archivo_mime IS NULL AND archivo_tamano_bytes IS NULL
    AND archivo_revision IS NULL AND archivo_sha256 IS NULL))`;
const FIELDS = `id,profesional_id,titulo,coalesce(descripcion,'') AS descripcion,tipo,url,categoria,
  activo,fecha_creacion,carpeta_id,archivo_mime,archivo_tamano_bytes,archivo_revision,archivo_sha256`;

function serialize(row: ObjectValue): ObjectValue {
  return {
    ...row,
    fecha_creacion: (row.fecha_creacion as Date).toISOString(),
    archivo_tamano_bytes:
      row.archivo_tamano_bytes === null ? null : Number(row.archivo_tamano_bytes),
  };
}

export async function listEducation(db: Database, query: ObjectValue) {
  const values: unknown[] = [];
  const filters = [ELIGIBLE];
  for (const field of ['categoria', 'tipo'] as const) {
    if (typeof query[field] === 'string') {
      values.push(query[field]);
      filters.push(`${field}=$${values.length}`);
    }
  }
  if (typeof query.q === 'string') {
    values.push(query.q);
    filters.push(
      `position(lower($${values.length}) in lower(titulo || ' ' || coalesce(descripcion,'')))>0`,
    );
  }
  const where = filters.join(' AND ');
  // One statement provides the count and page from the same MVCC snapshot.
  values.push(query.limit ?? 20, query.skip ?? 0);
  const result = await db.query<{ total: string; contenidos: ObjectValue[] }>(
    `
    WITH eligible AS (SELECT ${FIELDS} FROM contenido_educativo WHERE ${where}),
    page AS (SELECT * FROM eligible ORDER BY fecha_creacion DESC,id ASC LIMIT $${values.length - 1} OFFSET $${values.length})
    SELECT (SELECT count(*)::text FROM eligible) AS total,
      coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY fecha_creacion DESC,id ASC) FROM page),'[]'::jsonb) AS contenidos`,
    values,
  );
  const row = result.rows[0]!;
  // Aggregated timestamps are JSON strings; bigint values are JSON numbers.
  return { total: Number(row.total), contenidos: row.contenidos };
}

export async function educationCategories(db: Database) {
  return {
    categorias: (
      await db.query<{ categoria: string }>(
        `SELECT DISTINCT categoria FROM contenido_educativo WHERE ${ELIGIBLE} ORDER BY categoria`,
      )
    ).rows.map((r) => r.categoria),
  };
}

export async function educationDetail(db: Database, id: string) {
  const row = (
    await db.query<ObjectValue>(
      `SELECT ${FIELDS} FROM contenido_educativo WHERE id=$1 AND ${ELIGIBLE}`,
      [id],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Recurso no publicado.');
  return serialize(row);
}
