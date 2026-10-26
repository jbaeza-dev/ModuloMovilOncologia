import { readConfig } from './config/index.js';
import { openDatabase } from './persistence/database.js';
import { migrate } from './persistence/migrations.js';
try {
  const db = openDatabase(readConfig().databaseUrl);
  try {
    await migrate(db);
    process.stdout.write('Migraciones gateway aplicadas.\n');
  } finally {
    await db.end();
  }
} catch {
  process.stderr.write(
    'No se pudieron aplicar las migraciones gateway; revisar configuración y base.\n',
  );
  process.exitCode = 1;
}
