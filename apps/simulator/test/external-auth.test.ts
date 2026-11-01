import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { verifyExternalAccess } from '../src/auth.js';
import { readConfig, type SimulatorConfig } from '../src/config.js';
import { createSimulator } from '../src/app.js';
import type { Database } from '../src/db.js';

let jwksServer: Server, simulator: Server;
let config: SimulatorConfig, base: string;
const pair = await generateKeyPair('ES256');
const subject = 'e0000000-0000-4000-8000-000000000001';
async function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: subject,
    iss: config.issuer,
    aud: 'authenticated',
    iat: now,
    exp: now + 3600,
    role: 'authenticated',
    email: 'synthetic@example.test',
    app_metadata: { provider: 'google' },
    ...overrides,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .sign(pair.privateKey);
}
beforeAll(async () => {
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256' };
  jwksServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  jwksServer.listen(0, '127.0.0.1');
  await once(jwksServer, 'listening');
  const address = jwksServer.address() as { port: number };
  config = {
    ...readConfig({
      APP_ENV: 'universidad-demo',
      PREPARATION_ENABLED: 'true',
      DATABASE_URL: 'postgres://unused/test',
      DEMO_CONTROL_KEY: 'synthetic-control-key-only-for-local-test',
      SIMULATOR_PUBLIC_BASE_URL: 'http://127.0.0.1:3102',
      AUTH_EXPECTED_ISSUER: 'https://auth.example/auth/v1',
      AUTH_JWKS_URL: 'https://auth.example/auth/v1/.well-known/jwks.json',
    }),
    authJwksUrl: `http://127.0.0.1:${address.port}/jwks`,
  };
  simulator = createSimulator(config, {
    query: async () => {
      throw new Error('must not reach database');
    },
  } as unknown as Database);
  simulator.listen(0, '127.0.0.1');
  await once(simulator, 'listening');
  base = `http://127.0.0.1:${(simulator.address() as { port: number }).port}`;
});
afterAll(async () => {
  await Promise.all(
    [jwksServer, simulator].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});
describe('external Google identity verification', () => {
  it('accepts an ES256 Google identity and preserves UUID and issuer', async () => {
    expect(await verifyExternalAccess(config, await token())).toMatchObject({
      id: subject,
      issuer: config.issuer,
      tipo: 'external',
    });
  });
  it.each([
    { iss: 'https://wrong.example' },
    { aud: 'wrong' },
    { exp: 1 },
    { sub: 'invalid' },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { role: 'anon' },
    { is_anonymous: true },
    { app_metadata: { provider: 'email' }, user_metadata: { provider: 'google' } },
  ])('rejects invalid claims %j', async (claims) => {
    await expect(verifyExternalAccess(config, await token(claims))).rejects.toMatchObject({
      status: 401,
    });
  });
  it('rejects a signature with another key', async () => {
    const other = await generateKeyPair('ES256');
    const forged = await new SignJWT({ sub: subject })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .sign(other.privateKey);
    await expect(verifyExternalAccess(config, forged)).rejects.toMatchObject({ status: 401 });
  });
  it.each([
    '/authorize',
    '/auth/v1/authorize',
    '/token',
    '/auth/v1/token',
    '/auth/v1/.well-known/jwks.json',
  ])('does not expose a synthetic Google issuer at %s', async (path) => {
    expect(
      (await fetch(base + path, { method: path.endsWith('token') ? 'POST' : 'GET' })).status,
    ).toBe(404);
  });
  it('does not accept the demo control key as an operator session', async () => {
    expect(
      (
        await fetch(base + '/admin/api/v1/vinculaciones/consumir', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + config.controlKey },
        })
      ).status,
    ).toBe(401);
  });
});
