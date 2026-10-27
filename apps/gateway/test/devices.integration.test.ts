import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { validateResponse } from '@quimiocare/contracts';
import { openDatabase } from '../src/persistence/database.js';
import { migrate } from '../src/persistence/migrations.js';
import { createApp } from '../src/http/app.js';
import { testConfig } from './fixtures.js';
const url = process.env.GATEWAY_TEST_DATABASE_URL;
if (!url || !/^\/qc_gateway_demo[a-z0-9_]*_test$/.test(new URL(url).pathname))
  throw new Error('Use an isolated gateway test database.');
const db = openDatabase(url),
  owner = randomUUID(),
  other = randomUUID(),
  logs: string[] = [];
let clinical: ReturnType<typeof createServer>,
  gateway: ReturnType<typeof createServer>,
  base: string;
let profileStatus = 200,
  role = 'paciente',
  active = true,
  incorporation = 'COMPLETO',
  mismatch = false;
let tokens: Record<string, string>;
const body = () => ({
  sesion_id: randomUUID(),
  instalacion_id: randomUUID(),
  token_push: 'synthetic-' + randomUUID(),
  proveedor_push: 'expo',
  plataforma: 'android',
});
async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error();
  return `http://127.0.0.1:${a.port}`;
}
async function request(path: string, method = 'GET', value?: unknown, who = owner) {
  const r = await fetch(base + '/api/gateway/dispositivo/' + path, {
    method,
    headers: {
      authorization: 'Bearer ' + tokens[who],
      ...(value ? { 'content-type': 'application/json' } : {}),
    },
    ...(value ? { body: JSON.stringify(value) } : {}),
  });
  const result = await r.text();
  return {
    status: r.status,
    body: result ? (JSON.parse(result) as Record<string, unknown>) : null,
  };
}
beforeAll(async () => {
  await migrate(db);
  clinical = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.statusCode = profileStatus;
    const id = mismatch
      ? randomUUID()
      : req.headers.authorization === 'Bearer ' + tokens[owner]
        ? owner
        : other;
    res.end(
      JSON.stringify(
        profileStatus === 200
          ? {
              id,
              email: 'synthetic@example.com',
              rol: role,
              activo: active,
              estado_incorporacion: incorporation,
            }
          : {
              error: {
                codigo: 'HTTP_' + profileStatus,
                mensaje: 'Synthetic unavailable',
                status_code: profileStatus,
              },
            },
      ),
    );
  });
  const config = testConfig({ CLINICAL_API_URL: await listen(clinical) });
  tokens = {};
  for (const id of [owner, other])
    tokens[id] = await new SignJWT({ cohort: 'quimiocare-demo' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(id)
      .setIssuer(config.authIssuer)
      .setAudience(config.authAudience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.authVerifyKey));
  gateway = createServer(createApp(config, db, (line) => logs.push(JSON.stringify(line))));
  base = await listen(gateway);
});
beforeEach(async () => {
  profileStatus = 200;
  role = 'paciente';
  active = true;
  incorporation = 'COMPLETO';
  mismatch = false;
  await db.query('DELETE FROM gw_dispatch');
  await db.query('DELETE FROM gw_device');
});
afterAll(async () => {
  for (const s of [gateway, clinical]) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  await db.end();
});
describe('Device HTTP with real PostgreSQL and authoritative C-01', () => {
  it('creates, replays unchanged, rotates token with version and never returns it', async () => {
    const b = body();
    const created = await request('push-token', 'POST', b);
    expect(created.status).toBe(201);
    expect(validateResponse('G-02', 201, created.body).valid).toBe(true);
    const replay = await request('push-token', 'POST', b);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ sesion: { version: 1 } });
    const update = { ...b, token_push: 'rotated-synthetic-token' };
    expect((await request('push-token', 'POST', update)).status).toBe(409);
    expect(
      (await request('push-token', 'POST', { ...update, version_esperada: 1 })).body,
    ).toMatchObject({ sesion: { version: 2 } });
    expect(
      (await request('push-token', 'POST', { ...update, version_esperada: 1 })).body,
    ).toMatchObject({ sesion: { version: 2 } });
    expect((await request('push-token', 'POST', { ...b, version_esperada: 1 })).status).toBe(409);
    const detail = await request('sesiones/' + b.sesion_id);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail)).not.toContain('token_push');
    expect(logs.join('')).not.toContain(b.token_push);
    expect(logs.join('')).not.toContain(tokens[owner]);
  });
  it('serializes concurrent exact replay into one creation and one replay', async () => {
    const b = body();
    const results = await Promise.all([
      request('push-token', 'POST', b),
      request('push-token', 'POST', b),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect((await db.query('SELECT count(*)::int n FROM gw_device')).rows[0].n).toBe(1);
  });
  it.each(['instalacion_id', 'token_push'] as const)(
    'enforces concurrent unique %s without transferring ownership',
    async (field) => {
      const a = body(),
        b = { ...body(), [field]: a[field] };
      const results = await Promise.all([
        request('push-token', 'POST', a),
        request('push-token', 'POST', b, other),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body).toMatchObject({
        error: { codigo: 'REGISTRO_EN_CONFLICTO' },
      });
    },
  );
  it('does not let B read, overwrite or revoke A; absent and foreign are neutral', async () => {
    const a = body();
    await request('push-token', 'POST', a);
    for (const method of ['GET', 'DELETE']) {
      const foreign = await request('sesiones/' + a.sesion_id, method, undefined, other);
      const absent = await request('sesiones/' + randomUUID(), method, undefined, other);
      expect(foreign.status).toBe(404);
      expect(absent.status).toBe(404);
      expect(foreign.body).toMatchObject({
        error: { codigo: 'SESION_NO_ENCONTRADA', mensaje: 'Asociación no encontrada.' },
      });
    }
    expect((await request('push-token', 'POST', a, other)).status).toBe(409);
    expect((await request('sesiones/' + a.sesion_id)).body).toMatchObject({
      sesion: { activa: true },
    });
  });
  it('preserves timestamp microseconds and UUID order across owner-bound cursor pages', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const b = body();
      ids.push(b.sesion_id);
      await request('push-token', 'POST', b);
    }
    await db.query("UPDATE gw_device SET created_at='2026-10-26T12:00:00.123456Z'");
    ids.sort();
    let cursor: string | null = null;
    const seen: string[] = [];
    do {
      const r = await request('sesiones?limit=2' + (cursor ? '&cursor=' + cursor : ''));
      expect(r.status).toBe(200);
      expect(validateResponse('G-03', 200, r.body).valid).toBe(true);
      const page = r.body as { items: { id: string }[]; next_cursor: string | null };
      seen.push(...page.items.map((v) => v.id));
      cursor = page.next_cursor;
      if (cursor) {
        expect((await request('sesiones?cursor=' + cursor, 'GET', undefined, other)).status).toBe(
          422,
        );
        const tampered = cursor.slice(0, 15) + (cursor[15] === 'a' ? 'b' : 'a') + cursor.slice(16);
        expect((await request('sesiones?cursor=' + tampered)).status).toBe(422);
      }
    } while (cursor);
    expect(seen).toEqual(ids);
  });
  it('revokes idempotently, releases installation for B and a late A delete leaves B intact', async () => {
    const a = body();
    await request('push-token', 'POST', a);
    expect((await request('sesiones/' + a.sesion_id, 'DELETE')).status).toBe(204);
    expect((await request('push-token', 'POST', a)).body).toMatchObject({
      error: { codigo: 'SESION_REVOCADA' },
    });
    const b = { ...a, sesion_id: randomUUID() };
    expect((await request('push-token', 'POST', b, other)).status).toBe(201);
    expect((await request('sesiones/' + a.sesion_id, 'DELETE')).status).toBe(204);
    expect((await request('sesiones/' + b.sesion_id, 'GET', undefined, other)).body).toMatchObject({
      sesion: { activa: true, version: 1 },
    });
    expect((await request('sesiones/' + a.sesion_id)).body).toMatchObject({
      sesion: { activa: false, version: 2, token_registrado: false },
    });
  });
  it.each([401, 403, 503])(
    'retains identity/authorization/dependency distinction for C-01 %s',
    async (status) => {
      profileStatus = status;
      expect((await request('sesiones')).status).toBe(status);
    },
  );
  it.each(['role', 'inactive', 'incomplete', 'mismatch'])(
    'rejects authoritative %s independently of JWT role',
    async (mode) => {
      if (mode === 'role') role = 'medico';
      if (mode === 'inactive') active = false;
      if (mode === 'incomplete') incorporation = 'PENDIENTE';
      if (mode === 'mismatch') mismatch = true;
      expect((await request('sesiones')).status).toBe(403);
    },
  );
  it('rejects caller ownership, illegal cursors and limits before persistence', async () => {
    expect((await request('push-token', 'POST', { ...body(), owner_id: other })).status).toBe(422);
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=2&limit=3',
      'cursor=invalid',
      'activa=true',
    ])
      expect((await request('sesiones?' + query)).status).toBe(422);
  });
});
