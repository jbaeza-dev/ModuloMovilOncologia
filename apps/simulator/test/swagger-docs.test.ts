import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { createSimulator } from '../src/app.js';
import { readConfig, type SimulatorConfig } from '../src/config.js';
import type { Database } from '../src/db.js';
import { signAccess } from '../src/auth.js';
import { PATIENTS } from '../src/types.js';

let simulator: Server;
let base: string;
let config: SimulatorConfig;

const mockDb = {
  query: async (_sql: string, values?: unknown[]) => ({
    rows: values?.[1] === PATIENTS.A ? [{ id: PATIENTS.A }] : [],
    rowCount: values?.[1] === PATIENTS.A ? 1 : 0,
  }),
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  }),
} as unknown as Database;

beforeAll(async () => {
  config = readConfig({
    APP_ENV: 'demo',
    DATABASE_URL: 'postgres://unused/test',
    DEMO_SIGNING_KEY: 'test-signing-key-for-local-swagger-tests-min-32',
    DEMO_CONTROL_KEY: 'test-control-key-for-local-swagger-tests-min-32',
    SIMULATOR_PUBLIC_BASE_URL: 'http://127.0.0.1:3002',
    API_DOCS_ENABLED: 'true',
  });

  simulator = createSimulator(config, mockDb);
  simulator.listen(0, '127.0.0.1');
  await once(simulator, 'listening');
  const address = simulator.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => simulator.close(() => resolve()));
});

describe('Swagger UI Offline y Documentación Interactiva', () => {
  it('boots the protected schema with bearer only after auth and never forwards it to other origins', async () => {
    const html = await (await fetch(base + '/quimiocare/docs/preparacion/')).text();
    const inline = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    let createUi!: (token: string, view: string, interceptor: unknown) => Promise<unknown>;
    const authorizeRequest = vi.fn(
      (request: { url: string; headers: Record<string, string> }) => request,
    );
    const fetchSchema = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ openapi: '3.1.0', paths: {} }) });
    let options!: {
      requestInterceptor: (request: { url: string; headers: Record<string, string> }) => {
        headers: Record<string, string>;
      };
      responseInterceptor: (response: { status: number }) => unknown;
      onComplete: () => void;
    };
    const loadedUi = { ready: true, specActions: { updateJsonSpec: vi.fn() } };
    const bundle = Object.assign(
      vi.fn().mockImplementation((value) => {
        options = value;
        value.onComplete();
        return loadedUi;
      }),
      { presets: { apis: {} } },
    );
    const window = {
      onload: () => {},
      location: { href: base + '/quimiocare/docs/preparacion/', origin: base },
      initPreparationAuth: vi.fn((factory) => {
        createUi = factory;
      }),
      qcPreparationAuth: { expired: vi.fn() },
    };
    runInNewContext(inline, {
      window,
      fetch: fetchSchema,
      URL,
      AbortSignal,
      queueMicrotask,
      SwaggerUIBundle: bundle,
      SwaggerUIStandalonePreset: {},
    });
    window.onload();
    expect(bundle).not.toHaveBeenCalled();
    expect(fetchSchema).not.toHaveBeenCalled();
    await createUi('synthetic-operator', 'preparacion', authorizeRequest);
    expect(fetchSchema.mock.calls[0]![0]).toBe('/quimiocare/docs/preparacion/openapi.json');
    expect(fetchSchema.mock.calls[0]![1].headers.authorization).toBe('Bearer synthetic-operator');
    expect(options.requestInterceptor).toBe(authorizeRequest);
    await createUi('synthetic-operator', 'contrato', authorizeRequest);
    expect(fetchSchema.mock.calls[1]![0]).toBe('/quimiocare/docs/openapi.json');
    expect(loadedUi.specActions.updateJsonSpec).toHaveBeenCalledOnce();
    expect(bundle).toHaveBeenCalledTimes(1);
    options.responseInterceptor({ status: 401 });
    expect(window.qcPreparationAuth.expired).toHaveBeenCalledOnce();
    fetchSchema.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(createUi('synthetic-operator', 'contrato', authorizeRequest)).rejects.toThrow(
      'documentación',
    );
    expect(bundle).toHaveBeenCalledTimes(1);
  });
  it.each([
    '/docs/preparacion/openapi.json',
    '/docs/openapi.json',
    '/docs/evaluacion/openapi.json',
    '/quimiocare/docs/preparacion/openapi.json',
    '/quimiocare/docs/openapi.json',
    '/quimiocare/docs/evaluacion/openapi.json',
  ])('requires an active operator on the JSON itself: %s', async (path) => {
    const token = signAccess(config, 'A', 'docs-test');
    const absent = await fetch(base + path);
    expect(absent.status).toBe(401);
    expect(absent.headers.get('cache-control')).toBe('no-store');
    expect(await absent.text()).not.toContain('"paths"');
    expect((await fetch(base + path + '?access_token=' + token)).status).toBe(401);
    const patient = await fetch(base + path, {
      headers: { authorization: 'Bearer ' + signAccess(config, 'B', 'docs-test') },
    });
    expect(patient.status).toBe(403);
    const expired = await fetch(base + path, {
      headers: {
        authorization: 'Bearer ' + signAccess(config, 'A', 'docs-test', Date.now() - 7200000),
      },
    });
    expect(expired.status).toBe(401);
    const operator = await fetch(base + path, { headers: { authorization: 'Bearer ' + token } });
    expect(operator.status).toBe(200);
    expect(operator.headers.get('access-control-allow-origin')).toBeNull();
    expect((await operator.json()).paths).toBeDefined();
  });
  it('redirects diagnostic HTML to the Google login and serves a closed preparation shell', async () => {
    const redirect = await fetch(base + '/quimiocare/docs/', { redirect: 'manual' });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('/quimiocare/docs/preparacion/?vista=contrato');
    const res = await fetch(base + '/quimiocare/docs/preparacion/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Inicia sesión para continuar');
    expect(html).not.toContain('Configuración inicial del acceso');
    expect(html).not.toContain('qc-callback');
    expect(html).toContain('id="qc-swagger-shell" hidden');
    expect(html).toContain('persistAuthorization: false');
    expect(html).toContain('validatorUrl: null');
    expect(html).not.toContain('url: "./openapi.json"');
    expect(html).not.toContain('/api/v1/pacientes/me');
    for (const cdn of ['unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'])
      expect(html).not.toContain(cdn);
  });

  it('redirige la UI auxiliar al Swagger principal', async () => {
    const res = await fetch(`${base}/quimiocare/docs/evaluacion/`, { redirect: 'manual' });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/quimiocare/docs/preparacion/');
  });

  it('sirve el callback y los recursos de login con prefijo y sin cachear credenciales', async () => {
    const response = await fetch(base + '/quimiocare/docs/preparacion/oauth/callback?code=example');
    const html = await response.text();
    expect(html).toContain('Entrar con Google');
    expect(html).toContain('/quimiocare/docs/preparacion/static/swagger-ui.css');
    expect(html).not.toContain('code=example');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const script = await fetch(base + '/quimiocare/docs/preparacion/preparation-auth.js');
    expect(script.status).toBe(200);
    expect(await script.text()).toContain('initPreparationAuth');
    const spec = await (
      await fetch(base + '/quimiocare/docs/preparacion/openapi.json', {
        headers: { authorization: 'Bearer ' + signAccess(config, 'A', 'docs-test') },
      })
    ).json();
    expect(spec.servers).toEqual([{ url: '/quimiocare', description: 'Este servidor' }]);
    expect(spec.paths['/admin/api/v1/vinculaciones/consumir'].post.security).toEqual([
      { OperadorBearer: [] },
    ]);
    expect(spec.tags.map((t: { name: string }) => t.name)).toEqual([
      '0. Vinculación del paciente',
      '1. Categorías',
      '2. Contenido educativo',
      '3. Términos vigentes',
      '4. Consentimiento sintético',
      '5. Contexto clínico',
      '6. Formularios',
      '7. Escenarios',
      '8. Supervisión de sincronización',
      '9. Profesionales',
      '10. Medicamentos',
    ]);
    const allOperationTags = Object.values(
      spec.paths as Record<string, Record<string, { tags?: string[] }>>,
    ).flatMap((methods) => Object.values(methods).flatMap((op) => op.tags ?? []));
    expect(allOperationTags).not.toContain('Consultar y gestionar demostración');
    const ctxExample =
      spec.paths['/admin/api/v1/preparacion/pacientes/{paciente_id}/contexto-clinico'].post
        .requestBody.content['application/json'].example;
    expect(ctxExample.perfil_clinico.medicamentos).toHaveLength(3);
    expect(ctxExample.perfil_clinico.medicamentos.every((m: { activo: boolean }) => m.activo)).toBe(
      true,
    );
  });

  it('devuelve la especificación unificada de 17 operaciones en /quimiocare/docs/openapi.json', async () => {
    const res = await fetch(`${base}/quimiocare/docs/openapi.json`, {
      headers: { authorization: 'Bearer ' + signAccess(config, 'A', 'docs-test') },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { paths: Record<string, unknown> };

    // 16 operaciones clínicas + 1 IA = 17 operaciones
    expect(json.paths['/api/v1/auth/me']).toBeDefined();
    expect(json.paths['/api/v1/pacientes/me/perfil-clinico']).toBeDefined();
    expect(json.paths['/api/v1/pacientes/me/tratamiento-activo']).toBeDefined();
    expect(json.paths['/api/v1/chat']).toBeDefined();
  });

  it('devuelve la especificación de evaluación en /quimiocare/docs/evaluacion/openapi.json', async () => {
    const res = await fetch(`${base}/quimiocare/docs/evaluacion/openapi.json`, {
      headers: { authorization: 'Bearer ' + signAccess(config, 'A', 'docs-test') },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { paths: Record<string, unknown> };

    expect(json.paths['/admin/api/v1/vinculaciones/consumir']).toBeDefined();
    expect(json.paths['/admin/api/v1/contenido-educativo']).toBeDefined();
  });

  it('sirve recursos estáticos locales desde swagger-ui-dist con cabeceras de seguridad', async () => {
    const cssRes = await fetch(`${base}/quimiocare/docs/static/swagger-ui.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');
    expect(cssRes.headers.get('x-content-type-options')).toBe('nosniff');

    const jsRes = await fetch(`${base}/quimiocare/docs/static/swagger-ui-bundle.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('application/javascript');
    expect(jsRes.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rechaza path traversal en recursos estáticos', async () => {
    const res = await fetch(`${base}/quimiocare/docs/static/..%2Fpackage.json`);
    expect(res.status).toBe(404);
  });

  it('devuelve 404 en todas las rutas de documentación cuando API_DOCS_ENABLED está desactivado', async () => {
    const disabledConfig: SimulatorConfig = {
      ...config,
      apiDocsEnabled: false,
    };
    const disabledSim = createSimulator(disabledConfig, mockDb);
    disabledSim.listen(0, '127.0.0.1');
    await once(disabledSim, 'listening');
    const disabledBase = `http://127.0.0.1:${(disabledSim.address() as { port: number }).port}`;

    try {
      const resDocs = await fetch(`${disabledBase}/quimiocare/docs/`);
      expect(resDocs.status).toBe(404);

      const resEval = await fetch(`${disabledBase}/quimiocare/docs/evaluacion/`);
      expect(resEval.status).toBe(404);

      const resSpec = await fetch(`${disabledBase}/quimiocare/docs/openapi.json`);
      expect(resSpec.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => disabledSim.close(() => resolve()));
    }
  });
});
