import { readFileSync } from 'node:fs';
import { SqlSyncRules } from '/app/packages/sync-rules/dist/index.js';

// Ejecutar dentro de la imagen fijada del servicio PowerSync
const rules = readFileSync('/config/sync-config.yaml', 'utf8');
const errors = SqlSyncRules.validate(rules, { defaultSchema: 'public' });
if (errors.length) {
  for (const error of errors) process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Configuración PowerSync universitaria válida con el compilador fijado.\n');
}
