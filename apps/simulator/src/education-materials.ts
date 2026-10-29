import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basename, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Database } from './db.js';
import { transaction } from './db.js';
import { ApiError } from './errors.js';
import { EDUCATION_ID } from './seed-data.js';

export const educationAssetsRoot = fileURLToPath(new URL('../assets/education/', import.meta.url));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
interface Material {
  id: string;
  title: string;
  description: string;
  category: string;
  type: 'imagen' | 'video';
  publishedAt: string;
  url?: string;
  file?: string;
  mime?: string;
  bytes?: number;
  revision?: string;
  sha256?: string;
}
export interface EducationMaterials {
  version: string;
  inventoryApproved: boolean;
  rightsConfirmed: boolean;
  accessibleTranscriptionsReviewed: boolean;
  syntheticPublisherId: string;
  expectedCounts: { images: number; onlineVideos: number };
  retiredIds: string[];
  items: Material[];
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function filePath(name: string) {
  if (basename(name) !== name) throw new Error('Nombre de archivo educativo inválido.');
  const path = resolve(educationAssetsRoot, name);
  if (!path.startsWith(resolve(educationAssetsRoot) + sep))
    throw new Error('Archivo fuera del directorio educativo.');
  return path;
}
export async function readEducationMaterials(): Promise<EducationMaterials> {
  const raw = await readFile(filePath('catalog.json'), 'utf8');
  if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('Catálogo educativo demasiado grande.');
  const data = JSON.parse(raw) as EducationMaterials;
  if (
    data.inventoryApproved !== true ||
    data.rightsConfirmed !== true ||
    data.accessibleTranscriptionsReviewed !== true ||
    !uuid.test(data.syntheticPublisherId) ||
    !Array.isArray(data.items) ||
    !Number.isSafeInteger(data.expectedCounts?.images) ||
    data.expectedCounts.images < 1 ||
    !Number.isSafeInteger(data.expectedCounts?.onlineVideos) ||
    data.expectedCounts.onlineVideos < 0 ||
    data.items.length !== data.expectedCounts.images + data.expectedCounts.onlineVideos ||
    !Array.isArray(data.retiredIds)
  )
    throw new Error('El catálogo no tiene las decisiones y revisión requeridas.');
  const ids = new Set<string>();
  for (const item of data.items) {
    if (
      !uuid.test(item.id) ||
      ids.has(item.id) ||
      !item.title?.trim() ||
      !item.category?.trim() ||
      !item.description?.trim() ||
      !Number.isFinite(Date.parse(item.publishedAt))
    )
      throw new Error('Identidad o metadatos educativos inválidos.');
    ids.add(item.id);
    if (item.type === 'imagen') {
      if (
        !uuid.test(item.revision ?? '') ||
        !/^[0-9a-f]{64}$/.test(item.sha256 ?? '') ||
        !['image/png', 'image/jpeg'].includes(item.mime ?? '') ||
        !Number.isSafeInteger(item.bytes) ||
        item.bytes! <= 0 ||
        item.bytes! > 5 * 1024 * 1024 ||
        item.file !== `${item.id}.${item.revision}.${item.mime === 'image/png' ? 'png' : 'jpg'}`
      )
        throw new Error('Publicación de imagen inválida.');
      const bytes = await readFile(filePath(item.file));
      if (bytes.length !== item.bytes || hash(bytes) !== item.sha256)
        throw new Error('Los bytes educativos no corresponden al inventario revisado.');
    } else if (
      item.type !== 'video' ||
      !/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(item.url ?? '') ||
      [item.file, item.mime, item.bytes, item.revision, item.sha256].some((v) => v !== undefined)
    )
      throw new Error('Solo se admiten imágenes verificadas o videos externos online.');
  }
  if (
    data.items.filter((item) => item.type === 'imagen').length !== data.expectedCounts.images ||
    data.retiredIds.some((id) => !uuid.test(id) || ids.has(id)) ||
    new Set(data.retiredIds).size !== data.retiredIds.length
  )
    throw new Error('Los recuentos o retiros no corresponden al inventario revisado.');
  return data;
}

export async function publishEducationMaterials(db: Database, publicBaseUrl: string) {
  const catalog = await readEducationMaterials();
  const base = new URL(publicBaseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Base de publicación inválida.');
  await transaction(db, async (client) => {
    for (const item of catalog.items) {
      const url =
        item.type === 'imagen'
          ? `${publicBaseUrl.replace(/\/$/, '')}/__demo/archivos/educacion/${item.id}/${item.revision}.${item.mime === 'image/png' ? 'png' : 'jpg'}`
          : item.url!;
      await client.query(
        `INSERT INTO contenido_educativo
        (id,profesional_id,titulo,descripcion,tipo,url,categoria,activo,fecha_creacion,carpeta_id,
         archivo_mime,archivo_tamano_bytes,archivo_revision,archivo_sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,null,$9,$10,$11,$12)
        ON CONFLICT(id) DO UPDATE SET titulo=excluded.titulo,descripcion=excluded.descripcion,
          tipo=excluded.tipo,url=excluded.url,categoria=excluded.categoria,activo=true,
          archivo_mime=excluded.archivo_mime,archivo_tamano_bytes=excluded.archivo_tamano_bytes,
          archivo_revision=excluded.archivo_revision,archivo_sha256=excluded.archivo_sha256`,
        [
          item.id,
          catalog.syntheticPublisherId,
          item.title,
          item.description,
          item.type,
          url,
          item.category,
          item.publishedAt,
          item.mime ?? null,
          item.bytes ?? null,
          item.revision ?? null,
          item.sha256 ?? null,
        ],
      );
    }
    // A revised inventory names its withdrawals explicitly; unrelated publishers are preserved.
    await client.query(
      'UPDATE contenido_educativo SET activo=false WHERE id=ANY($1::uuid[]) AND profesional_id=$2',
      [catalog.retiredIds, catalog.syntheticPublisherId],
    );
    // Preserve all clinical tables and accepted acts.
    await client.query('UPDATE contenido_educativo SET activo=false WHERE id=$1', [EDUCATION_ID]);
  });
  return {
    version: catalog.version,
    images: catalog.expectedCounts.images,
    onlineVideos: catalog.expectedCounts.onlineVideos,
    bytes: catalog.items.reduce((n, item) => n + (item.bytes ?? 0), 0),
  };
}

/** Only licensed educational bytes are served here; this endpoint never accepts patient files. */
export async function serveEducationMaterial(db: Database, pathname: string, res: ServerResponse) {
  const match = /^\/__demo\/archivos\/educacion\/([0-9a-f-]+)\/([0-9a-f-]+)\.(png|jpg)$/.exec(
    pathname,
  );
  if (!match || !uuid.test(match[1]!) || !uuid.test(match[2]!))
    throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Imagen no publicada.');
  const row = (
    await db.query<{ archivo_mime: string; archivo_tamano_bytes: string; archivo_sha256: string }>(
      `SELECT archivo_mime,archivo_tamano_bytes,archivo_sha256 FROM contenido_educativo
     WHERE id=$1 AND archivo_revision=$2 AND activo=true AND tipo='imagen'`,
      [match[1], match[2]],
    )
  ).rows[0];
  if (!row || row.archivo_mime !== (match[3] === 'png' ? 'image/png' : 'image/jpeg'))
    throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Imagen no publicada.');
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath(`${match[1]}.${match[2]}.${match[3]}`));
  } catch {
    throw new ApiError(503, 'HTTP_503', 'La imagen publicada no está disponible.');
  }
  if (
    bytes.length > 5 * 1024 * 1024 ||
    bytes.length !== Number(row.archivo_tamano_bytes) ||
    hash(bytes) !== row.archivo_sha256
  )
    throw new ApiError(
      503,
      'HTTP_503',
      'La imagen publicada no supera la verificación de integridad.',
    );
  res.writeHead(200, {
    'content-type': row.archivo_mime,
    'content-length': bytes.length,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}
