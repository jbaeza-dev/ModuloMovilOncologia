import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { validateResponse } from '@quimiocare/contracts';
import { createApp } from '../src/http/app.js';
import { openDatabase } from '../src/persistence/database.js';
import { createLogger } from '../src/http/logging.js';
import { RateLimiter } from '../src/http/rate-limit.js';
import { testConfig } from './fixtures.js';

describe('Balde de fichas por cuenta', () => {
  it('permite una ráfaga hasta el límite y luego pide esperar', () => {
    let now = 0;
    const limiter = new RateLimiter(3, () => now);
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, true]);
    const blocked = limiter.take('a');
    expect(blocked.allowed).toBe(false);
    // 3 por minuto: una ficha nueva cada 20 s.
    expect(blocked.retryAfterSeconds).toBe(20);
    now = 20_000;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('cada cuenta tiene su propio límite', () => {
    const limiter = new RateLimiter(1, () => 0);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    expect(limiter.take('b').allowed).toBe(true);
  });

  it('se recupera por completo con el tiempo, sin superar el máximo', () => {
    let now = 0;
    const limiter = new RateLimiter(2, () => now);
    limiter.take('a');
    limiter.take('a');
    now = 10 * 60_000;
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, false]);
  });

  it('rechaza una configuración inválida', () => {
    expect(() => new RateLimiter(0)).toThrow();
  });

  it('la configuración usa valores por defecto razonables y valida los rangos', () => {
    const config = testConfig();
    expect(config.rateLimitPerMinute).toBe(120);
    expect(config.rateLimitAiPerMinute).toBe(10);
    expect(() => testConfig({ GATEWAY_RATE_LIMIT_PER_MINUTE: '0' })).toThrow();
    expect(() => testConfig({ GATEWAY_RATE_LIMIT_AI_PER_MINUTE: 'diez' })).toThrow();
  });
});

describe('Límite de solicitudes en el gateway', () => {
  const config = testConfig({ GATEWAY_RATE_LIMIT_AI_PER_MINUTE: '1' });
  const db = openDatabase(config.databaseUrl);
  let server: Server, base: string;
  beforeAll(async () => {
    server = createServer(
      createApp(
        config,
        db,
        createLogger(() => undefined),
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
  const token = (sub: string) =>
    new SignJWT({ cohort: 'quimiocare-demo' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer(config.authIssuer)
      .setAudience(config.authAudience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.authVerifyKey));
  const ask = async (jwt: string) =>
    fetch(base + '/api/gateway/chatbot/consulta', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ mensaje: 'Hola' }),
    });

  it('responde 429 con Retry-After y error contractual al superar el límite del asistente', async () => {
    const jwt = await token(randomUUID());
    // La primera consulta pasa el límite (la IA de prueba no existe, así que falla por otra causa).
    expect((await ask(jwt)).status).not.toBe(429);
    const limited = await ask(jwt);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    const body: unknown = await limited.json();
    expect(body).toMatchObject({ error: { codigo: 'LIMITE_DE_SOLICITUDES' } });
    expect(validateResponse('G-06', 429, body).valid).toBe(true);
  });

  it('el límite es por cuenta: otra cuenta no queda bloqueada', async () => {
    expect((await ask(await token(randomUUID()))).status).not.toBe(429);
  });

  it('una solicitud sin sesión válida no consume el límite de nadie', async () => {
    const r = await fetch(base + '/api/gateway/chatbot/consulta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensaje: 'Hola' }),
    });
    expect(r.status).toBe(401);
  });
});
