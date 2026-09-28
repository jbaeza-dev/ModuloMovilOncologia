export type SqlValue = string | number | null;

export interface SqlConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, values?: SqlValue[]): Promise<void>;
  first<T>(sql: string, values?: SqlValue[]): Promise<T | null>;
  all<T>(sql: string, values?: SqlValue[]): Promise<T[]>;
  transaction(work: (transaction: SqlConnection) => Promise<void>): Promise<void>;
}
