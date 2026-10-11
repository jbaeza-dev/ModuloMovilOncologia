import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SqlConnection, SqlValue } from '../sql';

export const patientA = '11111111-1111-4111-8111-111111111111';
export const patientB = '22222222-2222-4222-8222-222222222222';
export const measured = '2026-09-28T12:30:00.000Z';
export const validVitals = {
  temperatura: 36.8,
  presion_sistolica: 120,
  presion_diastolica: 80,
  pulso: 72,
  saturacion_o2: 98,
};

export function nodeConnection(database: DatabaseSync): SqlConnection {
  const operations = {
    exec: async (sql: string) => {
      database.exec(sql);
    },
    run: async (sql: string, values: SqlValue[] = []) => {
      database.prepare(sql).run(...values);
    },
    first: async <T>(sql: string, values: SqlValue[] = []) =>
      (database.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T>(sql: string, values: SqlValue[] = []) =>
      database.prepare(sql).all(...values) as T[],
  };
  let queued: Promise<void> = Promise.resolve();
  return {
    ...operations,
    transaction(work) {
      const pending = queued.then(async () => {
        database.exec('BEGIN IMMEDIATE');
        try {
          await work({
            ...operations,
            transaction: async () => {
              throw new Error('Transacción anidada');
            },
          });
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      });
      queued = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  };
}

export function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? `extra-${index}`;
}

export function createSqliteTestHarness() {
  const opened: DatabaseSync[] = [];
  const temporary: string[] = [];

  function open(file = ':memory:'): SqlConnection {
    const native = new DatabaseSync(file);
    opened.push(native);
    return nodeConnection(native);
  }

  function createTempDir(prefix = 'quimiocare-sqlite-'): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    temporary.push(directory);
    return directory;
  }

  function closeLastOpened(): void {
    opened.pop()?.close();
  }

  function cleanup(): void {
    for (const database of opened.splice(0)) {
      try {
        database.close();
      } catch {
        // Ignorar si ya fue cerrada
      }
    }
    for (const directory of temporary.splice(0)) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // Ignorar si ya fue removida
      }
    }
  }

  return {
    open,
    createTempDir,
    closeLastOpened,
    cleanup,
  };
}
