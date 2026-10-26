import pg from 'pg';
import type { PoolClient } from 'pg';
export type Database = pg.Pool;
export function openDatabase(connectionString: string): Database {
  return new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 5000,
    query_timeout: 6000,
  });
}
export async function transaction<T>(
  db: Database,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      client.release(true);
      released = true;
    }
    throw error;
  } finally {
    if (!released) client.release();
  }
}
