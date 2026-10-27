import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { authenticator } from '../src/auth.js';
import { testConfig } from './fixtures.js';

const config = testConfig(),
  key = new TextEncoder().encode(config.authVerifyKey),
  id = randomUUID();
async function sign(claims: Record<string, unknown> = {}, secret = key, alg = 'HS256') {
  return new SignJWT({ cohort: 'quimiocare-demo', ...claims })
    .setProtectedHeader({ alg })
    .setSubject(id)
    .setIssuer(config.authIssuer)
    .setAudience(config.authAudience)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}
const auth = authenticator(config, () => {});
describe('JWT verification', () => {
  it('verifies a signed identity without trusting caller-supplied ownership', async () => {
    const token = await sign();
    expect(await auth.verify('Bearer ' + token)).toEqual({ id, token });
  });
  it.each([
    'missing',
    'forged',
    'algorithm',
    'issuer',
    'audience',
    'expired',
    'subject',
    'issued',
    'cohort',
    'future',
    'nbf',
  ])('rejects %s', async (scenario) => {
    let token = await sign();
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      sub: id,
      iss: config.authIssuer,
      aud: config.authAudience,
      iat: now,
      exp: now + 3600,
      cohort: 'quimiocare-demo',
    };
    if (scenario === 'missing') token = '';
    if (scenario === 'forged')
      token = await sign({}, new TextEncoder().encode('different-synthetic-private-key-32-bytes'));
    if (scenario === 'algorithm') token = await sign({}, key, 'HS384');
    if (scenario === 'issuer') payload.iss = 'other-environment';
    if (scenario === 'audience') payload.aud = 'other-audience';
    if (scenario === 'expired') payload.exp = now - 1;
    if (scenario === 'subject') payload.sub = 'profile-not-an-auth-uuid';
    if (scenario === 'issued') delete payload.iat;
    if (scenario === 'cohort') delete payload.cohort;
    if (scenario === 'future') payload.iat = now + 120;
    if (scenario === 'nbf') payload.nbf = now + 120;
    if (!['missing', 'forged', 'algorithm'].includes(scenario))
      token = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(key);
    await expect(auth.verify(token ? 'Bearer ' + token : undefined)).rejects.toMatchObject({
      status: 401,
      code: 'NO_AUTORIZADO',
    });
  });
  it('rejects unsigned alg=none and malformed, overlong or multiple credentials', async () => {
    for (const value of [
      'Bearer eyJhbGciOiJub25lIn0.e30.',
      'Basic credential',
      'Bearer a.b.c, other',
      'Bearer ' + 'a'.repeat(8200),
    ])
      await expect(auth.verify(value)).rejects.toMatchObject({ status: 401 });
  });
  it('never accepts a demo credential in production even with coincidentally shared key', async () => {
    const prod = authenticator({ ...config, appEnv: 'production' }, () => {});
    await expect(prod.verify('Bearer ' + (await sign()))).rejects.toMatchObject({ status: 401 });
  });
});

describe('Central JWKS configuration and key rotation', () => {
  let server: ReturnType<typeof createServer>, jwksUrl: string;
  let keys: unknown[] = [];
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const a = server.address();
    if (!a || typeof a === 'string') throw new Error();
    jwksUrl = `http://127.0.0.1:${a.port}/jwks`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  it.each(['RS256', 'ES256'] as const)(
    'verifies %s from configured JWKS and rejects unrelated keys',
    async (alg) => {
      const pair = await generateKeyPair(alg),
        other = await generateKeyPair(alg);
      const publicKey = {
        ...(await exportJWK(pair.publicKey)),
        kid: 'current-' + alg,
        alg,
        use: 'sig',
      };
      const rotatedKey = {
        ...(await exportJWK(other.publicKey)),
        kid: 'next-' + alg,
        alg,
        use: 'sig',
      };
      keys = [publicKey, rotatedKey];
      const central = authenticator(
        { ...config, authAlgorithm: alg, authJwksUrl: jwksUrl, authVerifyKey: '' },
        () => {},
      );
      async function token(privateKey: CryptoKey, kid: string) {
        return new SignJWT({ cohort: 'quimiocare-demo' })
          .setProtectedHeader({ alg, kid })
          .setSubject(id)
          .setIssuer(config.authIssuer)
          .setAudience(config.authAudience)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(privateKey);
      }
      expect(
        (await central.verify('Bearer ' + (await token(pair.privateKey, publicKey.kid)))).id,
      ).toBe(id);
      expect(
        (await central.verify('Bearer ' + (await token(other.privateKey, rotatedKey.kid)))).id,
      ).toBe(id);
      await expect(
        central.verify('Bearer ' + (await token(other.privateKey, publicKey.kid))),
      ).rejects.toMatchObject({ status: 401 });
    },
  );
  it('reports unavailable JWKS as a dependency failure', async () => {
    const central = authenticator(
      {
        ...config,
        authAlgorithm: 'RS256',
        authJwksUrl: 'http://127.0.0.1:1/jwks',
        authVerifyKey: '',
      },
      () => {},
    );
    const pair = await generateKeyPair('RS256');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'missing' })
      .setSubject(id)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(pair.privateKey);
    await expect(central.verify('Bearer ' + token)).rejects.toMatchObject({ status: 503 });
  });
});
