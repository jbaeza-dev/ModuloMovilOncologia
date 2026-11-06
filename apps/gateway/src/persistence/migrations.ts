import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transaction } from './database.js';
import type { Database } from './database.js';
export const MIGRATIONS = [
  '001-devices.sql',
  '002-agenda.sql',
  '003-agenda-history.sql',
  '004-dispatch-attempts.sql',
  '005-medication-reminder-binding.sql',
] as const;
export async function migrate(db: Database, target: number = MIGRATIONS.length): Promise<void> {
  if (!Number.isInteger(target) || target < 1 || target > MIGRATIONS.length)
    throw new Error('Versión de migración inválida.');
  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('quimiocare-gateway-migrations'))");
    await client.query(
      'CREATE TABLE IF NOT EXISTS gw_schema_migration (version integer PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await client.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM gw_schema_migration ORDER BY version',
    );
    if (applied.rows.some((row) => row.version > target))
      throw new Error('La base requiere una versión más reciente del gateway.');
    for (let index = 0; index < target; index++) {
      const sql = await readFile(
        new URL(`migrations/${MIGRATIONS[index]}`, import.meta.url),
        'utf8',
      );
      const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
      const prior = applied.rows.find((row) => row.version === index + 1);
      if (prior) {
        if (prior.checksum !== checksum)
          throw new Error('La migración aplicada cambió de contenido.');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO gw_schema_migration(version,checksum) VALUES($1,$2)', [
        index + 1,
        checksum,
      ]);
    }
  });
}
export async function databaseReady(db: Database): Promise<void> {
  const result = await db.query<{ version: number; checksum: string }>(
    'SELECT version,checksum FROM gw_schema_migration ORDER BY version',
  );
  if (result.rows.length !== MIGRATIONS.length) throw new Error('Migraciones pendientes.');
  for (const [index, file] of MIGRATIONS.entries()) {
    const raw = await readFile(new URL(`migrations/${file}`, import.meta.url), 'utf8');
    const canonicalHash = createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex');
    const rawHash = createHash('sha256').update(raw).digest('hex');
    const row = result.rows[index];
    if (
      row?.version !== index + 1 ||
      (row?.checksum !== canonicalHash && row?.checksum !== rawHash)
    )
      throw new Error('Esquema incompatible.');
  }
}
