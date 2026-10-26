import { readConfig } from './config.js';
import { migrate, openDatabase } from './db.js';

const db = openDatabase(readConfig().databaseUrl);
try {
  await migrate(db);
  process.stdout.write('Migración demo aplicada.\n');
} finally {
  await db.end();
}
