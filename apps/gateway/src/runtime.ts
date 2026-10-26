import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from './http/app.js';
import { openDatabase } from './persistence/database.js';
import { databaseReady } from './persistence/migrations.js';
import { createLogger } from './http/logging.js';
import type { GatewayConfig } from './config/index.js';
import type { Logger } from './http/logging.js';
export async function startGateway(config: GatewayConfig, log: Logger = createLogger()) {
  const db = openDatabase(config.databaseUrl);
  db.on('error', () => log({ event: 'dependency', dependency: 'database', state: 'unavailable' }));
  try {
    await databaseReady(db);
  } catch (error) {
    await db.end();
    throw error;
  }
  const server = createServer(createApp(config, db, log));
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(10000, config.requestTimeoutMs);
  server.keepAliveTimeout = 5000;
  try {
    server.listen(config.port, '0.0.0.0');
    await once(server, 'listening');
  } catch (error) {
    await db.end();
    throw error;
  }
  log({ event: 'startup', state: 'ready' });
  let closing: Promise<void> | undefined;
  return {
    server,
    db,
    stop: () =>
      (closing ??= (async () => {
        const timer = setTimeout(() => server.closeAllConnections(), config.shutdownTimeoutMs);
        timer.unref();
        try {
          await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections();
          });
          await db.end();
        } finally {
          clearTimeout(timer);
          log({ event: 'shutdown', state: 'unavailable' });
        }
      })()),
  };
}
