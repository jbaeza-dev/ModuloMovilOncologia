import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { probeAuthAuthority, validatePublicKeys } from '../scripts/auth-ready.mjs';

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic-key', alg: 'ES256' };
const env = {
  AUTH_JWKS_URL: 'https://auth.example/auth/v1/.well-known/jwks.json',
  AUTH_ALLOWED_ALGORITHM: 'ES256',
};
const json = (value, options = {}) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...options,
  });

test('imports real public keys and supports a rotation overlap', () => {
  assert.deepEqual(
    validatePublicKeys({ keys: [key, { ...key, kid: 'synthetic-standby' }] }, 'ES256'),
    { keys: 2, algorithms: ['ES256'] },
  );
});

test('rejects private material, duplicated IDs, incompatible algorithms and invalid curves', () => {
  for (const document of [
    { keys: [] },
    { keys: [key, key] },
    { keys: [{ ...key, d: 'private-not-allowed' }] },
    { keys: [{ ...key, kid: '' }] },
    { keys: [{ ...key, crv: 'P-384' }] },
    { keys: [{ ...key, x: 'broken' }] },
    { keys: [{ ...key, use: 'enc' }] },
    { keys: [{ ...key, key_ops: ['sign', 'verify'] }] },
  ])
    assert.throws(() => validatePublicKeys(document, 'ES256'));
  assert.throws(() => validatePublicKeys({ keys: [key] }, 'RS256'));
});

test('checks HTTPS, uses a timeout, rejects redirects and never sends an API key', async () => {
  let calls = 0;
  const result = await probeAuthAuthority(env, async (url, options) => {
    calls++;
    assert.equal(url.href, env.AUTH_JWKS_URL);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers, undefined);
    return json({ keys: [key] });
  });
  assert.equal(calls, 1);
  assert.equal(result.keys, 1);
  await assert.rejects(probeAuthAuthority({ ...env, AUTH_JWKS_URL: 'http://auth.example/keys' }));
  await assert.rejects(
    probeAuthAuthority({ ...env, AUTH_JWKS_URL: 'https://user:password@auth.example/keys' }),
  );
  await assert.rejects(probeAuthAuthority({ ...env, AUTH_ALLOWED_ALGORITHM: 'HS256' }));
});

test('supports the PowerSync environment without accepting symmetric keys', async () => {
  const result = await probeAuthAuthority({ PS_JWKS_URI: env.AUTH_JWKS_URL }, async () =>
    json({ keys: [key] }),
  );
  assert.equal(result.keys, 1);
  await assert.rejects(
    probeAuthAuthority({ PS_JWKS_URI: env.AUTH_JWKS_URL }, async () =>
      json({ keys: [{ kid: 'symmetric', alg: 'HS256', kty: 'oct', k: 'forbidden' }] }),
    ),
  );
});

test('reports connection and TLS failures without leaking lower-level data', async () => {
  await assert.rejects(
    probeAuthAuthority(env, async () => {
      throw new Error('private connection details');
    }),
    (error) => {
      assert.match(error.message, /DNS, salida HTTPS y TLS/);
      assert.doesNotMatch(error.message, /private connection details/);
      return true;
    },
  );
});

test('rejects HTTP errors, HTML, malformed JSON and declared oversized replies', async () => {
  const replies = [
    () => json({ error: 'failure' }, { status: 503 }),
    () => new Response('<html>unavailable</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () =>
      json(
        { keys: [key] },
        { headers: { 'content-type': 'application/json', 'content-length': '1000000' } },
      ),
  ];
  for (const reply of replies) await assert.rejects(probeAuthAuthority(env, async () => reply()));
});

test('bounds streamed replies without trusting Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(40000));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    probeAuthAuthority(
      env,
      async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    ),
  );
  assert.equal(cancelled, true);
});
