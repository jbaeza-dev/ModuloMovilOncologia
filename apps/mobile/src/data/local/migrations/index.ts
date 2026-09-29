import type { SqlConnection } from '../sql';
import { REGISTROS_SQL, REGISTROS_VERSION } from './001_registros';
import { CONTEXTO_SQL, CONTEXTO_VERSION } from './002_contexto';

export type Migration = { version: number; sql: string };
export const migrations: readonly Migration[] = [
  { version: REGISTROS_VERSION, sql: REGISTROS_SQL },
  { version: CONTEXTO_VERSION, sql: CONTEXTO_SQL },
];

export async function migrateDatabase(
  connection: SqlConnection,
  available: readonly Migration[] = migrations,
) {
  await connection.exec('PRAGMA journal_mode = WAL');
  await connection.exec('PRAGMA foreign_keys = ON');
  const row = await connection.first<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  const newest = available.at(-1)?.version ?? 0;
  if (current > newest)
    throw new Error('La base de datos requiere una versión más reciente de QuimioCare.');
  for (const migration of available) {
    if (migration.version <= current) continue;
    await connection.transaction(async (transaction) => {
      await transaction.exec(migration.sql);
      await transaction.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
