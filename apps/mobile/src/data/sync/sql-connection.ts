import type { CommonPowerSyncDatabase, LockContext } from '@powersync/common';
import type { SqlConnection, SqlValue } from '../local/core/sql';

/** Split migrations, respecting quoted text, comments and SQLite trigger bodies. */
export function sqlStatements(script: string): string[] {
  const result: string[] = [];
  let start = 0,
    quote = '',
    lineComment = false,
    blockComment = false;
  let word = '',
    lastWord = '',
    trigger = false;
  const consumeWord = () => {
    if (word) {
      lastWord = word.toUpperCase();
      word = '';
    }
  };
  for (let i = 0; i < script.length; i++) {
    const c = script[i],
      next = script[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === quote) {
        if (next === quote) i++;
        else quote = '';
      }
      continue;
    }
    if (c === '-' && next === '-') {
      consumeWord();
      lineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      consumeWord();
      blockComment = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      consumeWord();
      quote = c === '[' ? ']' : c;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      word += c;
      continue;
    }
    consumeWord();
    if (lastWord === 'TRIGGER') trigger = true;
    if (c === ';' && (!trigger || lastWord === 'END')) {
      const statement = script.slice(start, i).trim();
      if (statement) result.push(statement);
      start = i + 1;
      trigger = false;
      lastWord = '';
    }
  }
  if (quote || blockComment) throw new Error('Migración SQL incompleta.');
  const rest = script.slice(start).trim();
  if (rest) result.push(rest);
  return result;
}

function commands(db: Pick<LockContext, 'execute' | 'getAll' | 'getOptional'>) {
  return {
    async exec(sql: string) {
      for (const part of sqlStatements(sql)) await db.execute(part);
    },
    async run(sql: string, values: SqlValue[] = []) {
      await db.execute(sql, values);
    },
    first: <T>(sql: string, values: SqlValue[] = []) => db.getOptional<T>(sql, values),
    all: <T>(sql: string, values: SqlValue[] = []) => db.getAll<T>(sql, values),
  };
}

export function createSyncConnection(db: CommonPowerSyncDatabase): SqlConnection {
  return {
    ...commands(db),
    refreshSchema: () => db.database.refreshSchema(),
    async transaction(work) {
      await db.writeTransaction(async (native) => {
        await work({
          ...commands(native),
          transaction: async () => {
            throw new Error('No se admiten transacciones anidadas.');
          },
        });
      });
    },
  };
}
