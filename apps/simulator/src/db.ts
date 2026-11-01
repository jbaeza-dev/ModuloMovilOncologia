import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { migrateSimulator } from './persistence/migrations.js';

export type Database = pg.Pool;
export type SqlClient = Pick<PoolClient, 'query'>;

export function openDatabase(connectionString: string): Database {
  return new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 });
}

export async function transaction<T>(
  db: Database,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(
  client: SqlClient,
  query: string,
  values: unknown[] = [],
): Promise<T | undefined> {
  return (await client.query<T>(query, values)).rows[0];
}

export async function migrate(db: Database): Promise<void> {
  await migrateSimulator(db);
}
