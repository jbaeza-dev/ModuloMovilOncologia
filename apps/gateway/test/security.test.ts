import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { GatewayConfig } from '../src/config/index.js';
import { createApp } from '../src/http/app.js';
import { openDatabase } from '../src/persistence/database.js';
import { testConfig } from './fixtures.js';
async function serve(config: GatewayConfig, action: (base: string) => Promise<void>) {
  const db = openDatabase(config.databaseUrl),
    server = createServer(createApp(config, db, () => {}));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  try {
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.end();
  }
}
describe('Helmet and explicit browser origin policy', () => {
  it('sets security headers and rejects foreign browser origins by default', async () => {
    await serve(testConfig(), async (base) => {
      const health = await fetch(base + '/health');
      expect(health.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(health.headers.get('referrer-policy')).toBe('no-referrer');
      expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(health.headers.get('strict-transport-security')).toBeNull();
      const response = await fetch(base + '/api/gateway/dispositivo/sesiones', {
        headers: { origin: 'https://untrusted.example.test' },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(await response.text()).not.toContain('untrusted.example');
    });
  });
  it('allows only configured origins while leaving authentication closed', async () => {
    await serve(
      testConfig({ CORS_ALLOWED_ORIGINS: 'https://operator.example.test' }),
      async (base) => {
        const response = await fetch(base + '/api/gateway/dispositivo/sesiones', {
          headers: { origin: 'https://operator.example.test' },
        });
        expect(response.status).toBe(503);
        expect(response.headers.get('access-control-allow-origin')).toBe(
          'https://operator.example.test',
        );
        expect(response.headers.get('access-control-allow-credentials')).toBeNull();
      },
    );
  });
  it('accepts bounded preflight only for known methods and declared headers', async () => {
    await serve(
      testConfig({ CORS_ALLOWED_ORIGINS: 'https://operator.example.test' }),
      async (base) => {
        const headers = {
          origin: 'https://operator.example.test',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'Authorization,Content-Type',
        };
        expect(
          (await fetch(base + '/api/gateway/chatbot/consulta', { method: 'OPTIONS', headers }))
            .status,
        ).toBe(204);
        expect((await fetch(base + '/unknown', { method: 'OPTIONS', headers })).status).toBe(404);
        expect(
          (
            await fetch(base + '/api/gateway/chatbot/consulta', {
              method: 'OPTIONS',
              headers: { ...headers, 'access-control-request-headers': 'X-Demo-Control' },
            })
          ).status,
        ).toBe(403);
      },
    );
  });
  it('enables HTTPS policy headers for production', async () => {
    await serve({ ...testConfig(), appEnv: 'production' }, async (base) => {
      const response = await fetch(base + '/health');
      expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000');
      expect(response.headers.get('content-security-policy')).toContain(
        'upgrade-insecure-requests',
      );
    });
  });
  it.each(['*', 'null', 'https://example.test/path', 'https://user:password@example.test'])(
    'rejects invalid CORS configuration %s',
    (value) => {
      expect(() => testConfig({ CORS_ALLOWED_ORIGINS: value })).toThrow('CORS_ALLOWED_ORIGINS');
    },
  );
});
