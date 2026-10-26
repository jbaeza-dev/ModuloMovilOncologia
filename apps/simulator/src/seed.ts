import { readConfig } from './config.js';
import { openDatabase } from './db.js';
import { seedDatabase } from './seed-data.js';

const config = readConfig();
const db = openDatabase(config.databaseUrl);
try {
  await seedDatabase(db, config.publicBaseUrl);
  process.stdout.write('Dataset sintético preparado.\n');
} finally {
  await db.end();
}
