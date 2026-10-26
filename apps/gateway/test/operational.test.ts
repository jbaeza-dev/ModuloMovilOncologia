import { describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/http/app.js';
import { openDatabase } from '../src/persistence/database.js';
import { testConfig } from './fixtures.js';

describe('Operational startup and bounded requests', () => {
  it('exits before listening when mandatory configuration is incomplete', () => {
    const result = spawnSync(process.execPath, ['dist/server.js'], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      timeout: 5000,
      env: {
        APP_ENV: 'demo',
        GATEWAY_DATABASE_URL: 'postgresql://secret:private-password@localhost/qc_gateway_demo',
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Gateway no iniciado: revisar configuración');
    expect(result.stdout + result.stderr).not.toContain('private-password');
  });
  it('bounds an incomplete JSON upload without running a protected action', async () => {
    const config = { ...testConfig(), requestTimeoutMs: 150 };
    const db = openDatabase(config.databaseUrl);
    const server = createServer(createApp(config, db, () => {}));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    try {
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/api/gateway/chatbot/consulta',
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': 100 },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
            });
            res.on('end', () => {
              req.destroy();
              resolve({ status: res.statusCode ?? 0, body });
            });
          },
        );
        req.on('error', reject);
        req.write('{"mensaje":"incomplete');
      });
      expect(response.status).toBe(503);
      expect(response.body).toContain('SERVICIO_NO_DISPONIBLE');
      expect(response.body).not.toContain('incomplete');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.end();
    }
  });
});
