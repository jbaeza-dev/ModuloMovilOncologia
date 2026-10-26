import { createSimulator } from './app.js';
import { readConfig } from './config.js';
import { openDatabase } from './db.js';

const config = readConfig();
const db = openDatabase(config.databaseUrl);
await db.query('SELECT 1');
const server = createSimulator(config, db);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(config.port, config.host, () => {
  process.stdout.write(
    `Simulador ${config.service} listo en puerto ${config.port}. Datos sintéticos.\n`,
  );
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await db.end();
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
