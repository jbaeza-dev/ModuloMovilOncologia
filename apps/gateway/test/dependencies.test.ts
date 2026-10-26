import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { dependencyClients } from '../src/dependencies.js';
import { createLogger } from '../src/http/logging.js';
import { testConfig } from './fixtures.js';
let mode = 'ok',
  calls = 0,
  payload: unknown,
  path: string | undefined;
const server = createServer(async (req, res) => {
  calls++;
  path = req.url;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  payload = JSON.parse(Buffer.concat(chunks).toString() || 'null') as unknown;
  if (mode === 'timeout') {
    setTimeout(() => res.end('{}'), 300).unref();
    return;
  }
  if (mode === 'redirect') {
    res.writeHead(307, { location: '/another' });
    res.end();
    return;
  }
  res.setHeader('content-type', 'application/json');
  if (mode === 'invalid') {
    res.end('{secret');
    return;
  }
  if (mode === 'large') {
    res.end(' '.repeat(70000));
    return;
  }
  if (mode === 'error') {
    res.statusCode = 503;
    res.end(JSON.stringify({ detail: 'Servicio no disponible.' }));
    return;
  }
  res.end(
    JSON.stringify({
      respuesta: 'Respuesta sintética',
      fuentes: [],
      requiere_urgencia: false,
      confianza_nivel: 'baja',
      estado_respuesta: 'respuesta',
    }),
  );
});
let base: string;
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('No port');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
describe('Dependency clients with real HTTP and no POST replay', () => {
  it('sends only the current message with debug=false', async () => {
    mode = 'ok';
    const client = dependencyClients(testConfig({ AI_API_URL: base }), () => {});
    expect(
      (await client.queryAi('synthetic-token', { mensaje: 'hola', activar_alarmas: false })).status,
    ).toBe(200);
    expect(path).toBe('/api/v1/chat?debug=false');
    expect(payload).toEqual({ mensaje: 'hola', activar_alarmas: false });
  });
  it('rejects history before sending it to the dependency', async () => {
    const before = calls;
    await expect(
      dependencyClients(testConfig({ AI_API_URL: base }), () => {}).queryAi('token', {
        mensaje: 'hola',
        historial: [],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(calls).toBe(before);
  });
  it.each(['invalid', 'large', 'redirect'])(
    'rejects %s responses and never retries the POST',
    async (value) => {
      mode = value;
      const before = calls;
      await expect(
        dependencyClients(testConfig({ AI_API_URL: base }), () => {}).queryAi('token', {
          mensaje: 'hola',
        }),
      ).rejects.toMatchObject({ status: 502 });
      expect(calls).toBe(before + 1);
    },
  );
  it('times out explicitly and redacts dependency failures', async () => {
    mode = 'timeout';
    const logs: string[] = [],
      before = calls;
    await expect(
      dependencyClients(
        testConfig({ AI_API_URL: base, AI_TIMEOUT_MS: '100' }),
        createLogger((line) => logs.push(line)),
      ).queryAi('synthetic-bearer', { mensaje: 'synthetic-chat-text' }),
    ).rejects.toMatchObject({ status: 504, code: 'IA_TIEMPO_AGOTADO' });
    expect(calls).toBe(before + 1);
    expect(logs.join('')).not.toMatch(/synthetic-bearer|synthetic-chat-text/);
  });
  it('preserves a contractual dependency error as an error', async () => {
    mode = 'error';
    const result = await dependencyClients(testConfig({ AI_API_URL: base }), () => {}).queryAi(
      'token',
      { mensaje: 'hola' },
    );
    expect(result).toEqual({ status: 503, body: { detail: 'Servicio no disponible.' } });
  });
});
