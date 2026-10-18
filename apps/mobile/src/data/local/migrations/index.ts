import type { SqlConnection } from '../core/sql';
import { REGISTROS_SQL, REGISTROS_VERSION } from './001_registros';
import { CONTEXTO_SQL, CONTEXTO_VERSION } from './002_contexto';
import { DESCARGAS_SQL, DESCARGAS_VERSION } from './003_descargas';
import { FORMULARIOS_SQL, FORMULARIOS_VERSION } from './004_formularios';
import { CONTEXTO_CLINICO_SQL, CONTEXTO_CLINICO_VERSION } from './005_contexto_clinico';
import { CONSENTIMIENTOS_SQL, CONSENTIMIENTOS_VERSION } from './006_consentimientos';
import { EDUCACION_MULTIMEDIA_SQL, EDUCACION_MULTIMEDIA_VERSION } from './007_educacion_multimedia';
import {
  RECORDATORIOS_LOCALES_SQL,
  RECORDATORIOS_LOCALES_VERSION,
} from './008_recordatorios_locales';
import { FORMULARIOS_DIARIOS_SQL, FORMULARIOS_DIARIOS_VERSION } from './009_formularios_diarios';

export type Migration = { version: number; sql: string };
export const migrations: readonly Migration[] = [
  { version: REGISTROS_VERSION, sql: REGISTROS_SQL },
  { version: CONTEXTO_VERSION, sql: CONTEXTO_SQL },
  { version: DESCARGAS_VERSION, sql: DESCARGAS_SQL },
  { version: FORMULARIOS_VERSION, sql: FORMULARIOS_SQL },
  { version: CONTEXTO_CLINICO_VERSION, sql: CONTEXTO_CLINICO_SQL },
  { version: CONSENTIMIENTOS_VERSION, sql: CONSENTIMIENTOS_SQL },
  { version: EDUCACION_MULTIMEDIA_VERSION, sql: EDUCACION_MULTIMEDIA_SQL },
  { version: RECORDATORIOS_LOCALES_VERSION, sql: RECORDATORIOS_LOCALES_SQL },
  { version: FORMULARIOS_DIARIOS_VERSION, sql: FORMULARIOS_DIARIOS_SQL },
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
