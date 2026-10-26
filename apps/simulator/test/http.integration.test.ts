import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { fixtures, validateResponse } from '@quimiocare/contracts';
import { createSimulator } from '../src/app.js';
import { openDatabase, migrate } from '../src/db.js';
import type { Database } from '../src/db.js';
import { readConfig } from '../src/config.js';
import {
  FORMS,
  EDUCATION_ID,
  resetDatabase,
  seedDatabase,
  mobileFixtures,
  ORIGINAL_TERMS_ID,
} from '../src/seed-data.js';
import { PATIENTS } from '../src/types.js';
import type { ObjectValue, Scenario } from '../src/types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'test:integration requiere TEST_DATABASE_URL apuntando a PostgreSQL sintético desechable. No se usa memoria como sustituto.',
  );
const testDatabaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!testDatabaseName.endsWith('_test')) {
  throw new Error(
    'La suite reinicia datos sintéticos y exige una base cuyo nombre termine en _test.',
  );
}

const config = readConfig({
  APP_ENV: 'demo',
  DATABASE_URL: databaseUrl,
  DEMO_SIGNING_KEY: 'synthetic-integration-signing-key-not-production',
  DEMO_CONTROL_KEY: 'synthetic-integration-control-key-not-production',
  SIMULATOR_PUBLIC_BASE_URL: 'http://127.0.0.1:3002',
});
let db: Database;
let clinical: Server;
let ai: Server;
let base = '',
  aiBase = '';
interface Session {
  access_token: string;
  refresh_token: string;
  user: { id: string };
}

async function call<T = ObjectValue>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    control?: boolean;
    ai?: boolean;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.control) headers['x-demo-control'] = config.controlKey;
  const response = await fetch(`${options.ai ? aiBase : base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
}
async function session(patient: 'A' | 'B' = 'A') {
  const result = await call<Session>('/__demo/auth/session', {
    method: 'POST',
    body: { paciente_demo: patient },
  });
  expect(result.status).toBe(200);
  return result.body;
}
async function scenario(name: Scenario, patient: 'A' | 'B' = 'A') {
  const result = await call('/__demo/escenario-activo', {
    method: 'PUT',
    control: true,
    body: { paciente_demo: patient, escenario: name },
  });
  expect(result.status).toBe(200);
}
async function accept(token: string, operation = randomUUID()) {
  const terms = await call('/api/v1/terminos/vigente', { token });
  const input = {
    definicion_terminos_id: terms.body.id,
    operacion_id: operation,
    codigo: 'TERMINOS_PLATAFORMA',
  };
  const result = await call('/api/v1/pacientes/me/consentimientos', {
    method: 'POST',
    token,
    body: input,
  });
  expect(result.status).toBe(201);
  return { result, input };
}
const sign = () => ({
  id: randomUUID(),
  fecha_registro: new Date(Date.now() - 60000).toISOString(),
  pulso: 72,
  temperatura: 36.6,
});

beforeAll(async () => {
  db = openDatabase(databaseUrl);
  await migrate(db);
  await seedDatabase(db, config.publicBaseUrl);
  clinical = createSimulator(config, db);
  clinical.listen(0, '127.0.0.1');
  await once(clinical, 'listening');
  ai = createSimulator({ ...config, service: 'ai' }, db);
  ai.listen(0, '127.0.0.1');
  await once(ai, 'listening');
  base = `http://127.0.0.1:${(clinical.address() as { port: number }).port}`;
  aiBase = `http://127.0.0.1:${(ai.address() as { port: number }).port}`;
});
beforeEach(async () => {
  await resetDatabase(db, config.publicBaseUrl);
});
afterAll(async () => {
  await Promise.all(
    [clinical, ai].filter(Boolean).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
  await db?.end();
});

describe('authenticated HTTP against persistent PostgreSQL', () => {
  it('requires bearer and operator credentials separately, and refuses unknown fields', async () => {
    expect((await call('/api/v1/auth/me')).status).toBe(401);
    expect((await call('/__demo/escenarios')).status).toBe(401);
    const token = (await session()).access_token;
    expect((await call('/__demo/escenarios', { token })).status).toBe(401);
    expect((await call('/__demo/escenarios', { control: true })).body.items).toHaveLength(12);
    expect(
      (
        await call('/__demo/auth/session', {
          method: 'POST',
          body: { paciente_demo: 'A', extra: true },
        })
      ).status,
    ).toBe(422);
  });
  it('returns distinct owner/profile/treatment spaces and validates incorporation', async () => {
    const a = await session(),
      b = await session('B');
    expect(a.user.id).toBe(PATIENTS.A);
    expect(b.user.id).toBe(PATIENTS.B);
    for (const [path, operation] of [
      ['/api/v1/auth/me', 'C-01'],
      ['/api/v1/pacientes/me/perfil-clinico', 'C-03'],
      ['/api/v1/pacientes/me/tratamiento-activo', 'C-04'],
    ] as const) {
      const result = await call(path!, { token: a.access_token });
      expect(result.status).toBe(200);
      expect(validateResponse(operation!, 200, result.body).valid).toBe(true);
    }
    const profile = await call('/api/v1/pacientes/me/perfil-clinico', { token: a.access_token });
    expect(profile.body.id).not.toBe(a.user.id);
    expect(
      (
        await call('/api/v1/auth/completar-perfil-paciente', {
          method: 'POST',
          token: a.access_token,
          body: { rut: '12.345.678-9' },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('/api/v1/auth/completar-perfil-paciente', {
          method: 'POST',
          token: a.access_token,
          body: { rut: '12.345.678-5' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('/api/v1/auth/completar-perfil-paciente', {
          method: 'POST',
          token: a.access_token,
          body: { rut: '12.345.678-5', rol: 'administrador', id: PATIENTS.B },
        })
      ).status,
    ).toBe(422);
    expect((await call('/api/v1/auth/me', { token: a.access_token })).body.id).toBe(PATIENTS.A);
  });
  it('rotates refresh exactly once under concurrency and preserves session ownership', async () => {
    const a = await session();
    const results = await Promise.all(
      [1, 2].map(() =>
        call<Session>('/__demo/auth/refresh', {
          method: 'POST',
          body: { refresh_token: a.refresh_token },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    const successful = results.find((r) => r.status === 200)!;
    expect(successful.body.user.id).toBe(PATIENTS.A);
    expect(successful.body.refresh_token).not.toBe(a.refresh_token);
    expect((await call('/api/v1/auth/me', { token: successful.body.access_token })).status).toBe(
      200,
    );
  });
  it('applies401 until renewed without invalidating controls or patient B', async () => {
    const a = await session(),
      b = await session('B');
    await scenario('SESION_EXPIRADA');
    expect((await call('/api/v1/auth/me', { token: a.access_token })).status).toBe(401);
    expect((await call('/api/v1/auth/me', { token: b.access_token })).status).toBe(200);
    const renewed = await call<Session>('/__demo/auth/refresh', {
      method: 'POST',
      body: { refresh_token: a.refresh_token },
    });
    expect((await call('/api/v1/auth/me', { token: renewed.body.access_token })).status).toBe(200);
  });
  it('distinguishes authorization and dependency failure, preserving B', async () => {
    const a = await session(),
      b = await session('B');
    await scenario('AUTORIZACION_DENEGADA');
    expect((await call('/api/v1/auth/me', { token: a.access_token })).status).toBe(403);
    expect((await call('/api/v1/auth/me', { token: b.access_token })).status).toBe(200);
    await scenario('SERVICIO_NO_DISPONIBLE');
    expect((await call('/api/v1/auth/me', { token: a.access_token })).status).toBe(503);
  });
  it('requires current consent and resolves replay before old-version checks, including revocation', async () => {
    const a = await session();
    expect(
      (
        await call('/api/v1/pacientes/me/signos-vitales', {
          method: 'POST',
          token: a.access_token,
          body: sign(),
        })
      ).status,
    ).toBe(403);
    const { input } = await accept(a.access_token);
    expect(
      (
        await call('/api/v1/pacientes/me/consentimientos', {
          method: 'POST',
          token: a.access_token,
          body: {
            ...input,
            operacion_id: randomUUID(),
            paciente_id: PATIENTS.B,
            otorgado_el: new Date().toISOString(),
          },
        })
      ).status,
    ).toBe(422);
    await scenario('TERMINOS_NUEVOS');
    expect(
      (await call('/api/v1/pacientes/me/consentimientos', { token: a.access_token })).body
        .requiere_aceptacion,
    ).toBe(true);
    const replay = await call('/api/v1/pacientes/me/consentimientos', {
      method: 'POST',
      token: a.access_token,
      body: input,
    });
    expect(replay.status).toBe(200);
    expect(
      (
        await call('/api/v1/pacientes/me/consentimientos', {
          method: 'POST',
          token: a.access_token,
          body: { ...input, operacion_id: randomUUID() },
        })
      ).status,
    ).toBe(409);
    await db.query(
      'UPDATE qc_demo_consentimiento SET revocado=true,revocado_el=now() WHERE id=$1',
      [input.operacion_id],
    );
    const revoked = await call('/api/v1/pacientes/me/consentimientos', {
      method: 'POST',
      token: a.access_token,
      body: input,
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.revocado).toBe(true);
    expect(
      (
        await call('/api/v1/pacientes/me/signos-vitales', {
          method: 'POST',
          token: a.access_token,
          body: sign(),
        })
      ).status,
    ).toBe(403);
  });
  it('does not expose another owner consent and checks families/unknown definitions', async () => {
    const a = await session(),
      b = await session('B');
    const { input } = await accept(a.access_token);
    expect(
      (
        await call('/api/v1/pacientes/me/consentimientos', {
          method: 'POST',
          token: b.access_token,
          body: input,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/api/v1/pacientes/me/consentimientos', {
          method: 'POST',
          token: a.access_token,
          body: { ...input, operacion_id: randomUUID(), codigo: 'OTRA_FAMILIA' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('/api/v1/pacientes/me/consentimientos', {
          method: 'POST',
          token: a.access_token,
          body: { ...input, operacion_id: randomUUID(), definicion_terminos_id: randomUUID() },
        })
      ).status,
    ).toBe(404);
  });
  it('persists signs and cuts ACK after commit; retry is200 with one row visible through a fresh DB connection', async () => {
    const a = await session();
    await accept(a.access_token);
    await scenario('ACK_SIGNOS_PERDIDO');
    const input = sign();
    await expect(
      call('/api/v1/pacientes/me/signos-vitales', {
        method: 'POST',
        token: a.access_token,
        body: input,
      }),
    ).rejects.toThrow();
    expect(
      (await db.query('SELECT count(*)::int AS n FROM qc_demo_signo WHERE id=$1', [input.id]))
        .rows[0].n,
    ).toBe(1);
    const replay = await call('/api/v1/pacientes/me/signos-vitales', {
      method: 'POST',
      token: a.access_token,
      body: input,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(input.id);
    expect(validateResponse('C-06', 200, replay.body).valid).toBe(true);
    const otherPool = openDatabase(databaseUrl);
    try {
      expect(
        (await otherPool.query('SELECT respuesta FROM qc_demo_signo WHERE id=$1', [input.id]))
          .rows[0].respuesta.id,
      ).toBe(input.id);
    } finally {
      await otherPool.end();
    }
  });
  it('handles concurrent same-sign UUID and rejects incompatible payload or owner without overwrite', async () => {
    const a = await session(),
      b = await session('B');
    await accept(a.access_token);
    await accept(b.access_token);
    const input = sign();
    const results = await Promise.all(
      [1, 2].map(() =>
        call('/api/v1/pacientes/me/signos-vitales', {
          method: 'POST',
          token: a.access_token,
          body: input,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    for (const [token, value] of [
      [a.access_token, { ...input, pulso: 75 }],
      [b.access_token, input],
    ] as const) {
      const r = await call('/api/v1/pacientes/me/signos-vitales', {
        method: 'POST',
        token,
        body: value,
      });
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.body)).not.toContain(PATIENTS.A);
    }
  });
  it('processes sign batch atomically with stable replay, independent pressure fields and422 invalid input', async () => {
    const a = await session();
    await accept(a.access_token);
    const first = sign(),
      second = { ...sign(), presion_arterial_diastolica: 80 };
    const result = await call('/api/v1/pacientes/me/signos-vitales/sync', {
      method: 'POST',
      token: a.access_token,
      body: { registros: [first, second] },
    });
    expect(result.status).toBe(201);
    expect(result.body.total_insertados).toBe(2);
    expect(
      (
        await call('/api/v1/pacientes/me/signos-vitales/sync', {
          method: 'POST',
          token: a.access_token,
          body: [first, second],
        })
      ).status,
    ).toBe(200);
    const third = sign();
    expect(
      (
        await call('/api/v1/pacientes/me/signos-vitales/sync', {
          method: 'POST',
          token: a.access_token,
          body: [third, { ...first, pulso: 79 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM qc_demo_signo WHERE id=$1', [third.id]))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await call('/api/v1/pacientes/me/signos-vitales', {
          method: 'POST',
          token: a.access_token,
          body: { ...sign(), pulso: 400 },
        })
      ).status,
    ).toBe(422);
  });
  it('returns edition snapshots and ePRO lost ACK replay201 without duplicating response', async () => {
    const a = await session();
    await accept(a.access_token);
    const form = await call('/api/v1/formularios/activo', { token: a.access_token });
    expect(form.body.preguntas as unknown[]).toHaveLength(41);
    expect(form.body.id).toBe(FORMS[0]!.id);
    expect(
      (await call(`/api/v1/formularios/${form.body.id}`, { token: a.access_token })).status,
    ).toBe(200);
    const raw = (mobileFixtures.operaciones['API-10'] as unknown as { request: ObjectValue })
      .request;
    const input = { ...raw, id: randomUUID() };
    const path = `/api/v1/formularios/${form.body.id}/respuestas`;
    await scenario('ACK_EPRO_PERDIDO');
    await expect(
      call(path, { method: 'POST', token: a.access_token, body: input }),
    ).rejects.toThrow();
    const replay = await call(path, { method: 'POST', token: a.access_token, body: input });
    expect(replay.status).toBe(201);
    expect(replay.body.paciente_id).toBe(PATIENTS.A);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM qc_demo_epro WHERE id=$1', [input.id]))
        .rows[0].n,
    ).toBe(1);
  });
  it('validates technical conditions and exclusivity using real payload rather than forced failures', async () => {
    const a = await session();
    await accept(a.access_token);
    await scenario('EDICION_CONDICIONAL');
    const technical = fixtures.conditions as unknown as {
      casos: { request: ObjectValue; status_esperado: number }[];
    };
    for (const c of technical.casos) {
      expect(
        (
          await call(`/api/v1/formularios/${FORMS[1]!.id}/respuestas`, {
            method: 'POST',
            token: a.access_token,
            body: { ...c.request, id: randomUUID() },
          })
        ).status,
      ).toBe(c.status_esperado);
    }
    await scenario('EXCLUSIVIDAD_ACTIVA');
    const q = FORMS[2]!.preguntas[0]!;
    for (const [value, expected] of [
      [['SOLO_ESTA'], 201],
      [['SOLO_ESTA', 'OP_A'], 422],
    ] as const) {
      expect(
        (
          await call(`/api/v1/formularios/${FORMS[2]!.id}/respuestas`, {
            method: 'POST',
            token: a.access_token,
            body: {
              id: randomUUID(),
              fecha_respuesta: new Date().toISOString(),
              respuestas: [{ pregunta_id: q.id, valor: value }],
            },
          })
        ).status,
      ).toBe(expected);
    }
  });
  it('filters education before pagination and preserves integrity metadata and original image bytes', async () => {
    const a = await session();
    const page = await call('/api/v1/contenido-educativo?skip=0&limit=1&categoria=quimioterapia', {
      token: a.access_token,
    });
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(1);
    expect(validateResponse('C-11', 200, page.body).valid).toBe(true);
    const detail = await call(`/api/v1/contenido-educativo/${EDUCATION_ID}`, {
      token: a.access_token,
    });
    expect(detail.status).toBe(200);
    const bytes = Buffer.from(
      await (await fetch(`${base}/__demo/archivos/imagen-prueba.png`)).arrayBuffer(),
    );
    expect(bytes.length).toBe(77);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(detail.body.archivo_sha256);
    expect(
      (await call('/api/v1/contenido-educativo/categorias', { token: a.access_token })).body
        .categorias,
    ).toEqual(['quimioterapia']);
    expect(
      (await call('/api/v1/contenido-educativo?limit=0', { token: a.access_token })).status,
    ).toBe(422);
    await db.query('UPDATE contenido_educativo SET descripcion=NULL WHERE id=$1', [EDUCATION_ID]);
    expect(
      (await call(`/api/v1/contenido-educativo/${EDUCATION_ID}`, { token: a.access_token })).body
        .descripcion,
    ).toBe('');
    await scenario('EDUCACION_RETIRADA');
    expect(
      (await call(`/api/v1/contenido-educativo/${EDUCATION_ID}`, { token: a.access_token })).status,
    ).toBe(404);
    expect(
      (await db.query('SELECT activo FROM contenido_educativo WHERE id=$1', [EDUCATION_ID])).rows[0]
        .activo,
    ).toBe(false);
  });
  it('generates server link codes, expires them after24h and does not invent GET recovery', async () => {
    const a = await session();
    const created = await call('/api/v1/pacientes/me/codigo-vinculacion', {
      method: 'POST',
      token: a.access_token,
    });
    expect(created.status).toBe(201);
    expect(created.body.codigo).toHaveLength(8);
    expect(Date.parse(String(created.body.fecha_expiracion)) - Date.now()).toBeGreaterThan(
      86390000,
    );
    expect(
      (
        await call('/api/v1/pacientes/me/codigo-vinculacion', {
          method: 'POST',
          token: a.access_token,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call('/api/v1/pacientes/me/codigo-vinculacion', { token: a.access_token })).status,
    ).toBe(404);
  });
  it('returns IA states independently of200 and discards conversation instead of persisting it', async () => {
    const a = await session();
    for (const [name, expected, urgent] of [
      ['NORMAL', 'respuesta', false],
      ['IA_NO_DISPONIBLE', 'no_disponible', false],
      ['IA_URGENCIA', 'no_disponible', true],
    ] as const) {
      await scenario(name);
      const response = await call('/api/v1/chat?debug=false', {
        method: 'POST',
        ai: true,
        token: a.access_token,
        body: { mensaje: 'Consulta sintética', activar_alarmas: true },
      });
      expect(response.status).toBe(200);
      expect(response.body.estado_respuesta).toBe(expected);
      expect(response.body.requiere_urgencia).toBe(urgent);
      expect(validateResponse('IA-01', 200, response.body).valid).toBe(true);
    }
    expect(
      (
        await call('/api/v1/chat', {
          method: 'POST',
          ai: true,
          token: a.access_token,
          body: { mensaje: 'x', historia: [] },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await db.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%chat%' ",
        )
      ).rows,
    ).toEqual([]);
  });
  it('reactivation resets lost-ACK counter without erasing stored writes; reset is explicit and protected', async () => {
    const a = await session();
    await accept(a.access_token);
    const input = sign();
    expect(
      (
        await call('/api/v1/pacientes/me/signos-vitales', {
          method: 'POST',
          token: a.access_token,
          body: input,
        })
      ).status,
    ).toBe(201);
    await scenario('ACK_SIGNOS_PERDIDO');
    await expect(
      call('/api/v1/pacientes/me/signos-vitales', {
        method: 'POST',
        token: a.access_token,
        body: input,
      }),
    ).rejects.toThrow();
    expect((await db.query('SELECT count(*)::int AS n FROM qc_demo_signo')).rows[0].n).toBe(1);
    const reset = { confirmar: 'REINICIAR_DATOS_SINTETICOS', seed: 'quimiocare-rc32-v1' };
    expect(
      (await call('/__demo/reset', { method: 'POST', token: a.access_token, body: reset })).status,
    ).toBe(401);
    expect(
      (await call('/__demo/reset', { method: 'POST', control: true, body: reset })).status,
    ).toBe(200);
    expect((await db.query('SELECT count(*)::int AS n FROM qc_demo_signo')).rows[0].n).toBe(0);
    expect(
      (await db.query('SELECT id FROM qc_demo_terminos WHERE id=$1', [ORIGINAL_TERMS_ID])).rows,
    ).toHaveLength(1);
  });
});
