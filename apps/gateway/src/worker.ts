import { pathToFileURL } from 'node:url';
import { readConfig } from './config/index.js';
import { openDatabase } from './persistence/database.js';
import { databaseReady } from './persistence/migrations.js';
import { AgendaDispatcher } from './dispatcher.js';
import { ExpoPushProvider } from './push-provider.js';
export async function runWorker(once = false) {
  const config = readConfig(),
    db = openDatabase(config.databaseUrl),
    abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await databaseReady(db);
    const dispatcher = new AgendaDispatcher(
      db,
      new ExpoPushProvider(fetch, 10000, process.env.EXPO_ACCESS_TOKEN),
    );
    do {
      try {
        const result = await dispatcher.tick(abort.signal);
        if (result.attempted || result.receipts)
          process.stdout.write(
            JSON.stringify({ service: 'quimiocare-dispatcher', event: 'tick', ...result }) + '\n',
          );
      } catch {
        process.stderr.write(
          JSON.stringify({ service: 'quimiocare-dispatcher', event: 'tick_failed' }) + '\n',
        );
        if (once) throw new Error('No se completó la ejecución del despachador.');
      }
      if (once || abort.signal.aborted) break;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          abort.signal.removeEventListener('abort', done);
          resolve();
        };
        timer = setTimeout(done, 5000);
        abort.signal.addEventListener('abort', done, { once: true });
        if (abort.signal.aborted) done();
      });
    } while (!abort.signal.aborted);
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await db.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runWorker(process.argv.includes('--once')).catch(() => {
    process.stderr.write('El despachador no pudo iniciarse.\n');
    process.exitCode = 1;
  });
