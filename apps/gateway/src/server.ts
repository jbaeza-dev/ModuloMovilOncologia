import { readConfig } from './config/index.js';
import { startGateway } from './runtime.js';
try {
  const runtime = await startGateway(readConfig());
  const shutdown = () => {
    void runtime.stop().catch(() => {
      process.stderr.write('Fallo durante el cierre del gateway.\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch {
  process.stderr.write('Gateway no iniciado: revisar configuración, conectividad y migraciones.\n');
  process.exitCode = 1;
}
