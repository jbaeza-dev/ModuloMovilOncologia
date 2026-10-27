import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { validateResponse } from '@quimiocare/contracts';
import { createApp } from '../src/http/app.js';
import { openDatabase } from '../src/persistence/database.js';
import { createLogger } from '../src/http/logging.js';
import { testConfig } from './fixtures.js';
const db = openDatabase(testConfig().databaseUrl);
const logs: string[] = [];
let server: Server, base: string;
async function post(path: string, value: unknown) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
}
beforeAll(async () => {
  server = createServer(
    createApp(
      testConfig(),
      db,
      createLogger((line) => logs.push(line)),
    ),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
});
describe('Real HTTP boundary with verified authentication', () => {
  it('serves contractual liveness without claiming database readiness', async () => {
    const r = await fetch(base + '/health');
    const body: unknown = await r.json();
    expect(r.status).toBe(200);
    expect(validateResponse('G-01', 200, body).valid).toBe(true);
    expect(r.headers.get('x-powered-by')).toBeNull();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(base + '/internal/ready')).status).toBe(503);
  });
  it.each([undefined, 'Bearer forged.jwt.token', 'Bearer synthetic-private-token'])(
    'never authorizes via unverified bearer %s',
    async (authorization) => {
      const r = await fetch(base + '/api/gateway/dispositivo/sesiones', {
        headers: authorization ? { authorization } : {},
      });
      expect(r.status).toBe(401);
      const body: unknown = await r.json();
      expect(body).toMatchObject({ error: { codigo: 'NO_AUTORIZADO' } });
      expect(validateResponse('G-03', 401, body).valid).toBe(true);
    },
  );
  it('normalizes malformed JSON without echoing it', async () => {
    const r = await fetch(base + '/api/gateway/chatbot/consulta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"mensaje":"secret chat',
    });
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain('secret chat');
  });
  it.each([
    { mensaje: 'hola', historial: ['secret'] },
    { mensaje: 1 },
    null,
    ['hola'],
    { mensaje: 'hola', paciente_id: randomUUID() },
  ])('rejects invalid/extra fields %#', async (body) => {
    expect([400, 422]).toContain((await post('/api/gateway/chatbot/consulta', body)).status);
  });
  it('applies the 16 KiB byte limit including multibyte characters', async () => {
    expect(
      (await post('/api/gateway/chatbot/consulta', { mensaje: '😀'.repeat(5000) })).status,
    ).toBe(413);
  });
  it('has a separate 64 KiB/100-event boundary', async () => {
    const item = {
      operacion_id: randomUUID(),
      sesion_id: randomUUID(),
      ocurrencia_id: 'a'.repeat(200),
      evento: 'abierto',
      ocurrido_en: new Date().toISOString(),
    };
    const items = Array.from({ length: 100 }, () => ({ ...item, operacion_id: randomUUID() }));
    expect(Buffer.byteLength(JSON.stringify({ items }))).toBeGreaterThan(16384);
    expect((await post('/api/gateway/notificaciones/acuses', { items })).status).toBe(401);
    expect(
      (await post('/api/gateway/notificaciones/acuses', { items: [...items, item] })).status,
    ).toBe(422);
    expect(
      (await post('/api/gateway/notificaciones/acuses', { items, extra: 'x'.repeat(65536) }))
        .status,
    ).toBe(413);
  });
  it('rejects undeclared and duplicate query values and bad UUIDs', async () => {
    for (const path of [
      '/api/gateway/dispositivo/sesiones?token=secret',
      '/api/gateway/dispositivo/sesiones?limit=2&limit=3',
      '/api/gateway/dispositivo/sesiones/not-a-uuid',
    ])
      expect((await fetch(base + path)).status).toBe(422);
  });
  it('does not expose a clinical upload proxy', async () => {
    expect((await post('/api/v1/pacientes/me/signos-vitales', { temperatura: 38 })).status).toBe(
      404,
    );
  });
  it('logs only neutral server-created correlation and safe metadata', async () => {
    const secret = 'synthetic-JWT-and-chat-secret';
    const r = await fetch(base + '/api/gateway/chatbot/consulta?authorization=' + secret, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'x-request-id': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mensaje: secret }),
    });
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    await r.text();
    const serialized = logs.join('');
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('private-password');
    for (const line of logs)
      expect(Object.keys(JSON.parse(line) as object)).not.toEqual(
        expect.arrayContaining(['body', 'headers', 'query', 'url', 'error']),
      );
    const projected: string[] = [];
    const logger = createLogger((line) => projected.push(line));
    logger({
      event: 'startup',
      ...JSON.parse(
        '{"body":"synthetic-secret","authorization":"synthetic-secret","config":"synthetic-secret"}',
      ),
    });
    expect(projected.join('')).not.toContain('synthetic-secret');
  });
});
