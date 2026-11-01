import pg from 'pg';
import { fixtures, fixtureImageUrl } from '@quimiocare/contracts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
if (!process.env.DATABASE_URL || !process.env.EDUCATION_MEDIA_ROOT)
  throw new Error('Explicit DATABASE_URL and EDUCATION_MEDIA_ROOT required.');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { rows } = await db.query(
    "SELECT id,archivo_revision,archivo_mime,archivo_sha256,archivo_tamano_bytes FROM contenido_educativo WHERE tipo='imagen' AND archivo_sha256 ~ '^[0-9a-f]{64}$' AND archivo_revision IS NOT NULL AND archivo_mime IN ('image/png','image/jpeg') AND archivo_tamano_bytes > 0",
  );
  for (const row of rows) {
    if (!/^[0-9a-f-]{36}$/.test(row.id) || !/^[0-9a-f-]{36}$/.test(row.archivo_revision))
      throw new Error('Invalid stored file identity.');
    const ext = row.archivo_mime === 'image/png' ? 'png' : 'jpg';
    let bytes;
    try {
      bytes = await readFile(
        resolve(process.env.EDUCATION_MEDIA_ROOT, row.id, row.archivo_revision + '.' + ext),
      );
    } catch {
      const fixture = fixtures.imageMetadata.contenido_educativo;
      if (
        row.id === fixture.id &&
        row.archivo_revision === fixture.archivo_revision &&
        row.archivo_sha256 === fixture.archivo_sha256
      )
        bytes = await readFile(fixtureImageUrl);
      else
        bytes = await readFile(
          new URL(`../assets/education/${row.id}.${row.archivo_revision}.${ext}`, import.meta.url),
        );
    }
    if (
      bytes.length !== Number(row.archivo_tamano_bytes) ||
      createHash('sha256').update(bytes).digest('hex') !== row.archivo_sha256
    )
      throw new Error('Integrity mismatch: ' + row.id);
  }
  console.log(JSON.stringify({ verified_referenced_images: rows.length }));
} finally {
  await db.end();
}
