import { it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { verifyExternalAccess } from '../src/auth.js';
import { readConfig } from '../src/config.js';
it('distributed verifier evicts revoked keys and fails closed after authority expiry', async () => {
  const pair = await generateKeyPair('ES256');
  const other = await generateKeyPair('ES256');
  let keys = [{ ...(await exportJWK(pair.publicKey)), kid: 'old', alg: 'ES256' }];
  let available = true;
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.writeHead(available ? 200 : 503);
    res.end(JSON.stringify({ keys }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const realFetch = globalThis.fetch;
  const address = server.address() as { port: number };
  vi.stubGlobal('fetch', (url: string | URL | Request, options?: RequestInit) =>
    realFetch(
      String(url).replace('http://qc-jwks:3004', 'http://127.0.0.1:' + address.port),
      options,
    ),
  );
  const issuer = 'https://synthetic.supabase.co/auth/v1';
  const token = await new SignJWT({ role: 'authenticated', app_metadata: { provider: 'google' } })
    .setProtectedHeader({ alg: 'ES256', kid: 'old' })
    .setSubject('e0000000-0000-4000-8000-000000000001')
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(pair.privateKey);
  const config = readConfig({
    APP_ENV: 'universidad-demo',
    DATABASE_URL: 'postgres://unused/test',
    DEMO_CONTROL_KEY: 'synthetic-control-key-only-for-local-test',
    SIMULATOR_PUBLIC_BASE_URL: 'https://example.org/quimiocare',
    AUTH_EXPECTED_ISSUER: issuer,
    AUTH_JWKS_MODE: 'distributed',
    AUTH_JWKS_URL: 'http://qc-jwks:3004/jwks.json',
  });
  const verify = (value: string) => verifyExternalAccess(config, value);
  try {
    await verify(token);
    keys = [{ ...(await exportJWK(other.publicKey)), kid: 'new', alg: 'ES256' }];
    await expect(verify(token)).rejects.toMatchObject({ status: 401 });
    available = false;
    await expect(verify(token)).rejects.toMatchObject({ status: 503 });
    available = true;
    const renewed = await new SignJWT({
      role: 'authenticated',
      app_metadata: { provider: 'google' },
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'new' })
      .setSubject('e0000000-0000-4000-8000-000000000001')
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(other.privateKey);
    await verify(renewed);
  } finally {
    vi.unstubAllGlobals();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
