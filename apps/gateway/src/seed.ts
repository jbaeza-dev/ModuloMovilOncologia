import { readConfig } from './config/index.js';
import { openDatabase, transaction } from './persistence/database.js';
import { databaseReady } from './persistence/migrations.js';
export async function seedDemo(db: ReturnType<typeof openDatabase>) {
  await databaseReady(db);
  await transaction(db, async (client) => {
    for (const owner of [
      '964d32f1-6941-579f-9f08-b60342194da9',
      '2dcb04f2-a2ad-5ea4-b711-9acd7e570002',
    ])
      await client.query('INSERT INTO gw_agenda(owner_id) VALUES($1) ON CONFLICT DO NOTHING', [
        owner,
      ]);
  });
}
// Separate opt-in seed; the server never seeds or resets operational tables.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/seed.js')) {
  try {
    const config = readConfig();
    if (config.appEnv !== 'demo') throw new Error('Solo demo.');
    const db = openDatabase(config.databaseUrl);
    try {
      await seedDemo(db);
      process.stdout.write('Semilla operativa sintética aplicada.\n');
    } finally {
      await db.end();
    }
  } catch {
    process.stderr.write('No se pudo aplicar la semilla operativa.\n');
    process.exitCode = 1;
  }
}
