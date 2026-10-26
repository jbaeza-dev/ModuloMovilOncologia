import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({
  options: {
    'clinical-base-url': { type: 'string', default: 'http://127.0.0.1:3002' },
    'bind-address': { type: 'string', default: '127.0.0.1' },
  },
});
const baseUrl = new URL(values['clinical-base-url']);
if (
  !['http:', 'https:'].includes(baseUrl.protocol) ||
  baseUrl.username ||
  baseUrl.password ||
  baseUrl.search ||
  baseUrl.hash
) {
  throw new Error('La URL clínica debe ser HTTP/HTTPS sin credenciales, query ni fragmento.');
}
if (!['127.0.0.1', '0.0.0.0'].includes(values['bind-address'])) {
  throw new Error('bind-address debe ser 127.0.0.1 o 0.0.0.0 en la red de prueba autorizada.');
}
const secret = () => randomBytes(32).toString('base64url');
const signingKey = secret();
const lines = [
  '# Credenciales locales sintéticas. No enviar por correo, no versionar y no reutilizar en real.',
  'APP_ENV=demo',
  `DEMO_BIND_ADDRESS=${values['bind-address']}`,
  `SIMULATOR_PUBLIC_BASE_URL=${baseUrl.href.replace(/\/$/, '')}`,
  `DEMO_DATABASE_ADMIN_PASSWORD=${secret()}`,
  `DEMO_DATABASE_PASSWORD=${secret()}`,
  `DEMO_REPLICA_PASSWORD=${secret()}`,
  `POWERSYNC_STORAGE_PASSWORD=${secret()}`,
  `DEMO_SIGNING_KEY=${signingKey}`,
  `DEMO_CONTROL_KEY=${secret()}`,
  `PS_DEMO_JWK=${Buffer.from(signingKey, 'utf8').toString('base64url')}`,
  `PS_ADMIN_TOKEN=${secret()}`,
  '',
];
const target = new URL('.env', import.meta.url);
await writeFile(target, lines.join('\n'), { flag: 'wx', mode: 0o600 });
process.stdout.write(
  `Configuración privada creada en ${fileURLToPath(target)}. No se muestran sus claves.\n`,
);
