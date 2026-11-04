import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import {
  validateSnapshot,
  fetchSnapshot,
  installSnapshot,
  lifetime,
} from '../scripts/jwks-snapshot.mjs';
import { createJwksServer } from '../scripts/jwks-service.mjs';

const issuer = 'https://synthetic.supabase.co/auth/v1';
const key = (kid) => ({
  ...generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' }),
  kid,
  alg: 'ES256',
  use: 'sig',
});
const snapshot = (jwks = { keys: [key('one')] }, fetchedAt = Date.now()) => ({
  schema: 1,
  issuer,
  fetchedAt,
  expiresAt: fetchedAt + lifetime,
  jwks,
});

test('rejects expired, future, wrong issuer, extended lifetime and private keys', () => {
  const good = snapshot();
  assert.equal(validateSnapshot(good, issuer, 'ES256'), good);
  for (const bad of [
    { ...good, issuer: 'https://other.example/auth/v1' },
    { ...good, fetchedAt: Date.now() + 60000 },
    { ...good, expiresAt: good.expiresAt + 1 },
    snapshot(good.jwks, Date.now() - lifetime),
    { ...good, jwks: { keys: [{ ...good.jwks.keys[0], d: 'private' }] } },
  ])
    assert.throws(() => validateSnapshot(bad, issuer, 'ES256'));
});

test('fetches only the official HTTPS discovery endpoint with bounded JSON', async () => {
  const publicKeys = { keys: [key('download')] };
  const result = await fetchSnapshot(issuer, 'ES256', async (url, options) => {
    assert.equal(url.href, issuer + '/.well-known/jwks.json');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers, undefined);
    return Response.json(publicKeys);
  });
  assert.deepEqual(result.jwks, publicKeys);
  for (const response of [
    new Response('oops', { status: 503 }),
    new Response('<html>'),
    Response.json({ keys: [] }),
    Response.json({ body: 'x'.repeat(65536) }),
  ])
    await assert.rejects(fetchSnapshot(issuer, 'ES256', async () => response));
});

test('real HTTP distribution rotates atomically, rejects stale replay, and fails closed on expiry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qc-jwks-test-'));
  const source = join(dir, 'incoming.json');
  const destination = join(dir, 'live');
  const first = snapshot();
  let now = first.fetchedAt;
  const server = createJwksServer({
    path: join(destination, 'snapshot.json'),
    issuer,
    algorithm: 'ES256',
    now: () => now,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/jwks.json')).status, 503);
    await writeFile(source, JSON.stringify(first));
    assert.equal(await installSnapshot(source, destination, issuer, 'ES256'), true);
    let response = await fetch(base + '/jwks.json');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), first.jwks);
    assert.equal(await installSnapshot(source, destination, issuer, 'ES256'), false);
    const second = snapshot({ keys: [key('rotated')] }, first.fetchedAt + 1);
    await writeFile(source, JSON.stringify(second));
    assert.equal(await installSnapshot(source, destination, issuer, 'ES256'), true);
    assert.deepEqual(await (await fetch(base + '/jwks.json')).json(), second.jwks);
    await writeFile(source, JSON.stringify(first));
    await assert.rejects(installSnapshot(source, destination, issuer, 'ES256'), /rollback/);
    assert.deepEqual(JSON.parse(await readFile(join(destination, 'snapshot.json'))), second);
    now = second.expiresAt;
    assert.equal((await fetch(base + '/jwks.json')).status, 503);
    assert.equal((await fetch(base + '/ready')).status, 503);
    assert.equal((await fetch(base + '/arbitrary')).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
