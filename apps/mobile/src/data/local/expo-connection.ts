import type { SQLiteDatabase } from 'expo-sqlite';
import type { SqlConnection, SqlValue } from './sql';

type Commands = Pick<SQLiteDatabase, 'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;

function commands(connection: Commands): Omit<SqlConnection, 'transaction'> {
  return {
    exec: (sql) => connection.execAsync(sql),
    run: async (sql, values: SqlValue[] = []) => {
      await connection.runAsync(sql, values);
    },
    first: (sql, values: SqlValue[] = []) => connection.getFirstAsync(sql, values),
    all: (sql, values: SqlValue[] = []) => connection.getAllAsync(sql, values),
  };
}

export function createExpoConnection(database: SQLiteDatabase): SqlConnection {
  let queued: Promise<void> = Promise.resolve();
  return {
    ...commands(database),
    transaction(work) {
      const pending = queued.then(() =>
        database.withExclusiveTransactionAsync(async (nativeTx) => {
          const tx: SqlConnection = {
            ...commands(nativeTx),
            transaction: async () => {
              throw new Error('No se admiten transacciones anidadas.');
            },
          };
          await work(tx);
        }),
      );
      queued = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  };
}
