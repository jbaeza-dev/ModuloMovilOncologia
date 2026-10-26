import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: new URL('../', import.meta.url),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += String(chunk);
});
child.stderr.on('data', (chunk) => {
  output += String(chunk);
});
try {
  const base = `http://127.0.0.1:${process.env.GATEWAY_PORT ?? '3001'}`;
  let ready = false;
  for (let index = 0; index < 60; index++) {
    if (child.exitCode !== null) throw new Error('Gateway terminó antes de estar listo.');
    try {
      ready = (await fetch(base + '/internal/ready', { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      /* bounded startup probe */
    }
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw new Error('Gateway no disponible.');
  const response = await fetch(base + '/health');
  const body = await response.json();
  if (response.status !== 200 || body.servicio !== 'quimiocare-gateway' || body.estado !== 'ok')
    throw new Error('Health incompatible.');
  if ((await fetch(base + '/api/gateway/dispositivo/sesiones')).status !== 503)
    throw new Error('Ruta protegida abierta.');
  process.stdout.write('Gateway smoke: health, readiness y cierre por defecto correctos.\n');
} finally {
  const terminated =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 12000);
  timeout.unref();
  await terminated;
  clearTimeout(timeout);
}
if (process.platform !== 'win32' && !output.includes('"event":"shutdown"'))
  throw new Error('No hubo cierre ordenado.');
