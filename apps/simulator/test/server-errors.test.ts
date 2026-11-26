import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { readConfig } from '../src/config.js';
import { createSimulator } from '../src/app.js';
import type { Database } from '../src/db.js';
import { ApiError } from '../src/errors.js';
import { logServerError } from '../src/error-log.js';
import type { IncomingMessage } from 'node:http';

const config = readConfig({
  APP_ENV: 'demo',
  DATABASE_URL: 'postgres://synthetic.invalid/demo',
  DEMO_SIGNING_KEY: 'synthetic-unit-test-signing-key-not-production',
  DEMO_CONTROL_KEY: 'synthetic-unit-test-control-key-not-production',
  SIMULATOR_PUBLIC_BASE_URL: 'http://synthetic.invalid/',
});
// Un error de PostgreSQL trae en su mensaje los valores que chocaron: nunca debe llegar al registro.
const leak = Object.assign(new Error('duplicate key value (rut)=(12.345.678-5) paciente Ana'), {
  code: '23505',
});
let server: Server | undefined;

async function start(query: () => Promise<unknown>) {
  const lines: string[] = [];
  server = createSimulator(config, { query } as unknown as Database, (line) => lines.push(line));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, lines };
}
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('errores internos del simulador', () => {
  it('responde un 500 genérico y deja una línea en el registro sin datos del paciente', async () => {
    const { base, lines } = await start(async () => {
      throw leak;
    });
    const response = await fetch(base + '/educacion/api/v1/podcasts?rut=12.345.678-5', {
      headers: { 'x-request-id': 'req-sintetico-1' },
    });
    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('Fallo interno del simulador.');
    expect(body).not.toContain('12.345.678-5');

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({
      event: 'error',
      service: 'quimiocare-clinical',
      method: 'GET',
      path: '/educacion/api/v1/podcasts',
      status: 500,
      code: 'ERROR_INTERNO_SERVIDOR',
      errorType: 'Error',
      dbCode: '23505',
      requestId: 'req-sintetico-1',
    });
    expect(lines[0]).not.toMatch(/12\.345\.678-5|Ana|duplicate|rut/);
  });

  it('registra también los 503 controlados, como una base caída', async () => {
    const { base, lines } = await start(async () => {
      throw leak;
    });
    expect((await fetch(base + '/health')).status).toBe(503);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      status: 503,
      code: 'SERVICIO_NO_DISPONIBLE',
      errorType: 'ApiError',
    });
  });

  it('reemplaza en la ruta los identificadores y los números, y quita los parámetros', () => {
    const lines: string[] = [];
    const id = '950E8A9D-8575-4293-8E88-F2F4DB1921D9';
    const req = {
      method: 'GET',
      url: '/api/v1/pacientes/' + id + '/signos/42?desde=2026-11-01&rut=12.345.678-5',
      headers: {},
    } as unknown as IncomingMessage;
    logServerError(
      (line) => lines.push(line),
      'clinical',
      req,
      new ApiError(503, 'SERVICIO_NO_DISPONIBLE', 'Base de datos no disponible.'),
      leak,
    );
    expect(JSON.parse(lines[0]!).path).toBe('/api/v1/pacientes/:id/signos/:n');
    expect(lines[0]).not.toMatch(/950e8a9d|12\.345|desde|rut/i);
  });

  it('no registra los errores del cliente (4xx)', async () => {
    const { base, lines } = await start(async () => ({ rows: [] }));
    expect((await fetch(base + '/ruta-que-no-existe')).status).toBe(404);
    expect(lines).toHaveLength(0);
  });

  it('descarta un x-request-id que no tenga un formato seguro', async () => {
    const { base, lines } = await start(async () => {
      throw leak;
    });
    await fetch(base + '/health', {
      headers: { 'x-request-id': 'malo {"x"}' },
    });
    expect(JSON.parse(lines[0]!).requestId).toBeUndefined();
  });
});
