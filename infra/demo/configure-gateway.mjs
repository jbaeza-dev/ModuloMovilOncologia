import { randomBytes } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
const file = new URL('.env', import.meta.url);
const prior = await readFile(file, 'utf8');
if (!prior.includes('DEMO_DATABASE_ADMIN_PASSWORD='))
  throw new Error('Primero ejecutar configure.mjs para el laboratorio.');
if (!/^GATEWAY_DATABASE_PASSWORD=/m.test(prior)) {
  await appendFile(
    file,
    `\n# P02: base operativa propia; preservar junto a los volúmenes.\nGATEWAY_DATABASE_PASSWORD=${randomBytes(32).toString('base64url')}\n`,
    { mode: 0o600 },
  );
}
process.stdout.write(
  'Configuración gateway disponible; no se muestran claves ni se cambian credenciales existentes.\n',
);
