import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HttpSessionAdapter, DEMO_AUTH_IDS } from './http-session-adapter';
import { DeviceClient } from './device-client';
import { DEMO_USERS } from './demo-session-adapter';
import { sessionConfig } from './session-config';
import type { CredentialVault } from './credential-vault';
import { canUpload } from './response-checks';
const owner = DEMO_AUTH_IDS[0],
  other = DEMO_AUTH_IDS[1];
const config = sessionConfig({
  APP_ENV: 'demo',
  CLINICAL_URL: 'http://clinical.test',
  GATEWAY_URL: 'http://gateway.test',
  AUTH_ISSUER: 'quimiocare-demo',
  AUTH_AUDIENCE: 'authenticated',
})!;
class Vault implements CredentialVault {
  data = new Map<string, string>();
  async read(k: string) {
    return this.data.get(k) ?? null;
  }
  async write(k: string, v: string) {
    this.data.set(k, v);
  }
  async remove(k: string) {
    this.data.delete(k);
  }
}
const termId = randomUUID(),
  profileId = randomUUID(),
  treatmentId = randomUUID(),
  consentId = randomUUID();
const terms = {
  id: termId,
  codigo: 'TERMINOS_PLATAFORMA',
  version: '1.0',
  titulo: 'Términos sintéticos',
  texto_completo: 'Texto técnico no institucional',
  vigente_desde: '2026-01-01',
  vigente: true,
  obligatorio: true,
};
function harness(vault = new Vault()) {
  let identity = owner as string,
    generation = 0,
    expired = false,
    refreshStatus = 200,
    consentRequired = false,
    revoked = false,
    dropAccept = false,
    profileStatus = 200,
    treatmentStatus = 200,
    clinicalStatus = 200;
  const calls: { path: string; method: string; body: string; token: string }[] = [];
  let delay: (() => Promise<void>) | null = null;
  const fake: typeof fetch = vi.fn(async (input, init) => {
    const path = new URL(String(input)).pathname,
      body = typeof init?.body === 'string' ? init.body : '',
      token = (init?.headers as Record<string, string>)?.authorization ?? '';
    calls.push({ path, body, token, method: init?.method ?? 'GET' });
    const response = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    function creds() {
      return {
        access_token: 'token-' + identity + '-' + generation,
        refresh_token: 'refresh-' + identity + '-' + generation,
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: identity, paciente_demo: identity === owner ? 'A' : 'B' },
      };
    }
    if (path === '/__demo/auth/session') {
      identity = JSON.parse(body).paciente_demo === 'A' ? owner : other;
      generation++;
      expired = false;
      return response(creds());
    }
    if (path === '/__demo/auth/refresh') {
      await Promise.resolve();
      if (refreshStatus !== 200) return response({}, refreshStatus);
      generation++;
      expired = false;
      return response(creds());
    }
    if (path === '/api/v1/terminos/vigente') return response(terms);
    if (path === '/delayed' && delay) {
      const saved = identity;
      await delay();
      return response({ owner: saved });
    }
    if (expired || token !== 'Bearer token-' + identity + '-' + generation)
      return response({}, 401);
    if (path === '/api/v1/auth/me')
      return response(
        {
          id: identity,
          email: 'synthetic@example.com',
          nombre: identity === owner ? 'Cuenta A' : 'Cuenta B',
          rol: 'paciente',
          activo: true,
          estado_incorporacion: 'COMPLETO',
        },
        profileStatus,
      );
    if (path === '/api/v1/pacientes/me/perfil-clinico')
      return response(
        { id: profileId, fecha_actualizacion: '2026-10-26T12:00:00Z', medicamentos: [] },
        clinicalStatus,
      );
    if (path === '/api/v1/pacientes/me/tratamiento-activo')
      return response(
        {
          id: treatmentId,
          tipo_tratamiento_id: randomUUID(),
          tipo_tratamiento_codigo: 'quimioterapia',
          tipo_tratamiento_nombre: 'Quimioterapia',
        },
        treatmentStatus,
      );
    const current = {
      id: consentId,
      paciente_id: identity,
      definicion_terminos_id: termId,
      otorgado_el: '2026-10-26T12:00:00Z',
      revocado: revoked,
    };
    if (path === '/api/v1/pacientes/me/consentimientos') {
      if (init?.method === 'POST') {
        if (dropAccept) {
          dropAccept = false;
          throw new TypeError('Synthetic lost ACK');
        }
        if (!revoked) consentRequired = false;
        return response(current, 200);
      }
      return response({
        requiere_aceptacion: consentRequired,
        terminos_vigentes: terms,
        consentimiento_actual: current,
        historial_previo: [],
      });
    }
    if (path.includes('dispositivo/sesiones') && init?.method === 'DELETE')
      return new Response(null, { status: 204 });
    return response({ ok: true });
  });
  const session = new HttpSessionAdapter({ config, vault, fetch: fake, newId: randomUUID });
  return {
    session,
    vault,
    fake,
    calls,
    setExpired: (v = true) => {
      expired = v;
    },
    setRefresh: (v: number) => {
      refreshStatus = v;
    },
    setConsent: (required: boolean, isRevoked = false) => {
      consentRequired = required;
      revoked = isRevoked;
    },
    dropAccept: () => {
      dropAccept = true;
    },
    setClinical: (v: number) => {
      clinicalStatus = v;
    },
    setTreatment: (v: number) => {
      treatmentStatus = v;
    },
    setProfile: (v: number) => {
      profileStatus = v;
    },
    setDelay: (v: () => Promise<void>) => {
      delay = v;
    },
  };
}
const login = (h: ReturnType<typeof harness>, index = 0) =>
  h.session.selectDemoPatient(DEMO_USERS[index]!.id);
describe('Transporte de chat con presupuesto propio y sin replay automático', () => {
  it('conserva errores del gateway sin pausar el contexto clínico por una caída del asistente', async () => {
    const h = harness();
    await login(h);
    const before = h.session.getSnapshot();
    const detail = { detail: 'Servicio IA no disponible.' };
    vi.mocked(h.fake).mockResolvedValueOnce(
      new Response(JSON.stringify(detail), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(
      await h.session.request(
        'gateway',
        '/api/gateway/chatbot/consulta',
        'POST',
        { mensaje: 'consulta' },
        { preserveServiceErrors: true, retryUnauthorized: false },
      ),
    ).toEqual({ status: 503, body: detail });
    expect(h.session.getSnapshot().stale).toBe(before.stale);
    expect(h.session.getSnapshot().uploadAllowed).toBe(before.uploadAllowed);
  });
  it('no repite el POST de una consulta que recibe 401', async () => {
    const h = harness();
    await login(h);
    const before = vi.mocked(h.fake).mock.calls.length;
    vi.mocked(h.fake).mockResolvedValueOnce(
      new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }),
    );
    await expect(
      h.session.request(
        'gateway',
        '/api/gateway/chatbot/consulta',
        'POST',
        { mensaje: 'consulta' },
        { retryUnauthorized: false, preserveServiceErrors: true },
      ),
    ).rejects.toMatchObject({ kind: 'expired' });
    expect(vi.mocked(h.fake).mock.calls.length - before).toBe(1);
  });
  it('permite esperar más de 60 segundos sin usar el timeout corto del perfil', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await login(h);
      vi.mocked(h.fake).mockImplementationOnce(
        async () =>
          new Promise<Response>((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
                ),
              61000,
            ),
          ),
      );
      const pending = h.session.request(
        'gateway',
        '/api/gateway/chatbot/consulta',
        'POST',
        { mensaje: 'consulta' },
        { timeoutMs: 75000, retryUnauthorized: false, preserveServiceErrors: true },
      );
      await vi.advanceTimersByTimeAsync(61001);
      await expect(pending).resolves.toEqual({ status: 200, body: { ok: true } });
    } finally {
      vi.useRealTimers();
    }
  });
  it('propaga la cancelación de la consulta a fetch sin cerrar la identidad', async () => {
    const h = harness();
    await login(h);
    const c = new AbortController();
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    vi.mocked(h.fake).mockImplementationOnce(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('cancelled');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
          start();
        }),
    );
    const pending = h.session.request(
      'gateway',
      '/api/gateway/chatbot/consulta',
      'POST',
      { mensaje: 'consulta' },
      { signal: c.signal, timeoutMs: 75000, retryUnauthorized: false, preserveServiceErrors: true },
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    c.abort();
    await rejected;
    expect(h.session.getCurrentUser()?.id).toBe(owner);
  });
});

describe('HTTP identity, credentials and account isolation', () => {
  it('uses authenticated C14 for the active account and public C14 before login', async () => {
    const h = harness();
    await h.session.publicTerms();
    expect(h.calls.find((v) => v.path === '/api/v1/terminos/vigente')?.token).toBe('');
    await login(h);
    const requests = h.calls.filter((v) => v.path === '/api/v1/terminos/vigente').slice(1);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((v) => v.token.includes(owner))).toBe(true);
  });
  it('rebuilds legacy local identity from Auth owner when restoring a cache', async () => {
    const h = harness();
    await login(h);
    const saved = JSON.parse(h.vault.data.get('active')!);
    saved.identity.user.localPatientId = DEMO_USERS[1].id;
    await h.vault.write('active', JSON.stringify(saved));
    const restored = new HttpSessionAdapter({
      config,
      vault: h.vault,
      fetch: h.fake,
      newId: randomUUID,
    });
    expect((await restored.restore()).success).toBe(true);
    expect(restored.getCurrentUser()?.localPatientId).toBe(DEMO_USERS[0].id);
  });
  it('keeps a real UUID independent of demo aliases even if it equals a fixture UUID', async () => {
    const h = harness();
    const real = new HttpSessionAdapter({
      config: { ...config, mode: 'production', scope: 'production-distinct' },
      vault: new Vault(),
      fetch: h.fake,
      newId: randomUUID,
      googleLogin: async () => ({
        access_token: 'token-' + owner + '-0',
        refresh_token: 'synthetic-real-test',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: owner },
      }),
    });
    expect((await real.login({})).success).toBe(true);
    expect(real.getCurrentUser()).toMatchObject({
      id: owner,
      localPatientId: owner,
      isDemo: false,
    });
  });
  it('maps Auth UUID independently from preserved local identity, profile and treatment', async () => {
    const h = harness();
    expect((await login(h)).success).toBe(true);
    const s = h.session.getSnapshot();
    expect(s.user).toMatchObject({ id: owner, localPatientId: DEMO_USERS[0].id });
    expect(s.identity?.clinicalProfile?.id).toBe(profileId);
    expect(s.identity?.treatment?.id).toBe(treatmentId);
    expect(s.uploadAllowed).toBe(true);
    expect(JSON.parse(h.vault.data.get('active')!).credentials.owner).toBe(owner);
  });
  it('restores the same account after a new adapter instance without selecting a new demo session', async () => {
    const h = harness();
    await login(h);
    const restored = new HttpSessionAdapter({
      config,
      vault: h.vault,
      fetch: h.fake,
      newId: randomUUID,
    });
    expect((await restored.restore()).success).toBe(true);
    expect(restored.getCurrentUser()?.id).toBe(owner);
    expect(h.calls.filter((v) => v.path === '/__demo/auth/session')).toHaveLength(1);
  });
  it('coordinates concurrent 401s into one refresh and retries identical immutable operations', async () => {
    const h = harness();
    await login(h);
    h.setExpired();
    const original = { id: randomUUID(), fecha_registro: '2026-10-26T12:00:00Z', temperatura: 37 };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => h.session.request('clinical', '/capture', 'POST', original)),
    );
    expect(results.every((v) => v.status === 200)).toBe(true);
    expect(h.calls.filter((v) => v.path === '/__demo/auth/refresh')).toHaveLength(1);
    const sent = h.calls.filter((v) => v.path === '/capture');
    expect(new Set(sent.map((v) => v.body)).size).toBe(1);
    expect(JSON.parse(sent[0]!.body)).toEqual(original);
  });
  it('preserves credentials, owner and capture on a failed renewal instead of deleting local data', async () => {
    const h = harness();
    await login(h);
    h.setExpired();
    h.setRefresh(401);
    const capture = { id: randomUUID(), text: 'Synthetic preserved capture' };
    await expect(h.session.request('clinical', '/capture', 'POST', capture)).rejects.toMatchObject({
      kind: 'expired',
    });
    expect(h.session.getState()).toBe('expired');
    expect(h.session.getCurrentUser()?.id).toBe(owner);
    expect(h.vault.data.has('active')).toBe(true);
    expect(capture.text).toBe('Synthetic preserved capture');
    expect(h.session.getSnapshot().uploadAllowed).toBe(false);
  });
  it('keeps an unavailable authorization service distinct from an invalid session', async () => {
    const h = harness();
    await login(h);
    h.setProfile(503);
    await expect(h.session.refreshIdentity()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(h.session.getState()).toBe('service_unavailable');
    expect(h.session.getCurrentUser()?.id).toBe(owner);
  });
  it('discards a delayed A response after closing A and authenticating B', async () => {
    const h = harness();
    await login(h);
    let release!: () => void;
    h.setDelay(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const request = h.session.request('clinical', '/delayed');
    const rejected = expect(request).rejects.toMatchObject({ kind: 'changed' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await h.session.logout();
    await login(h, 1);
    release();
    await rejected;
    expect(h.session.getCurrentUser()?.id).toBe(other);
    expect(h.session.getSnapshot().identity?.owner).toBe(other);
  });
  it('never reuses demo credentials or identity when APP_ENV or service scope changes', async () => {
    const h = harness();
    await login(h);
    for (const changed of [
      { ...config, mode: 'production' as const, scope: 'different-production' },
      { ...config, scope: 'different-clinical-authority' },
    ]) {
      const real = new HttpSessionAdapter({
        config: changed,
        vault: h.vault,
        fetch: h.fake,
        newId: randomUUID,
      });
      expect((await real.restore()).success).toBe(false);
      expect(real.getCurrentUser()).toBeNull();
      expect(real.getSnapshot().identity).toBeNull();
    }
  });
  it('preserves a cached profile when its dependency is down without claiming it is missing', async () => {
    const h = harness();
    await login(h);
    h.setClinical(503);
    await h.session.refreshIdentity();
    expect(h.session.getSnapshot().identity?.clinicalProfile?.id).toBe(profileId);
    expect(h.session.getSnapshot().identity?.clinicalStatus).toBe('unavailable');
    expect(h.session.getSnapshot().stale).toBe(true);
    expect(h.session.getSnapshot().uploadAllowed).toBe(false);
  });
  it('distinguishes confirmed 404 profile/treatment absence from 503', async () => {
    const h = harness();
    await login(h);
    h.setClinical(404);
    h.setTreatment(404);
    await h.session.refreshIdentity();
    expect(h.session.getSnapshot().identity).toMatchObject({
      clinicalProfile: null,
      treatment: null,
      clinicalStatus: 'missing',
      treatmentStatus: 'missing',
    });
    expect(h.session.getState()).toBe('clinical_incomplete');
    expect(h.session.getSnapshot().uploadAllowed).toBe(false);
  });
  it('stops a registered PowerSync connector and invalidates its signal before removing credentials', async () => {
    const h = harness();
    await login(h);
    const credentials = await h.session.credentialsForSync(),
      stop = vi.fn(async () => {});
    h.session.registerConnector(stop);
    await h.session.logout();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(credentials.signal.aborted).toBe(true);
    expect(h.vault.data.has('active')).toBe(false);
  });
});
describe('Online authoritative consent', () => {
  it('cannot authorize from an HTTP 200 describing a revoked acceptance', async () => {
    const h = harness();
    h.setConsent(true, true);
    await login(h);
    expect(h.session.getState()).toBe('terms_pending');
    await expect(h.session.acceptTerms()).rejects.toMatchObject({ kind: 'denied' });
    expect(h.session.getSnapshot().uploadAllowed).toBe(false);
  });
  it('keeps one operation UUID across a lost ACK and repeats only contractual fields', async () => {
    const h = harness();
    h.setConsent(true);
    await login(h);
    h.dropAccept();
    await expect(h.session.acceptTerms()).rejects.toMatchObject({ kind: 'unavailable' });
    await h.session.refreshIdentity();
    await h.session.acceptTerms();
    const requests = h.calls.filter(
      (v) => v.path.endsWith('/consentimientos') && v.method === 'POST',
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]!.body).toBe(requests[1]!.body);
    expect(Object.keys(JSON.parse(requests[0]!.body)).sort()).toEqual([
      'codigo',
      'definicion_terminos_id',
      'operacion_id',
    ]);
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
  });
  it('does not persist a successful local acceptance when the server is offline', async () => {
    const h = harness();
    h.setConsent(true);
    await login(h);
    h.setExpired();
    h.setRefresh(503);
    await expect(h.session.acceptTerms()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(h.session.getSnapshot().uploadAllowed).toBe(false);
    expect(h.session.getSnapshot().consent?.requiere_aceptacion).toBe(true);
  });
  it('requires matching current definition and unrevoked personal state together', () => {
    expect(canUpload(null, terms)).toBe(false);
    expect(canUpload({ requiere_aceptacion: false }, terms)).toBe(false);
    expect(
      canUpload(
        {
          requiere_aceptacion: false,
          terminos_vigentes: { ...terms, obligatorio: true },
          consentimiento_actual: {
            id: consentId,
            paciente_id: owner,
            definicion_terminos_id: randomUUID(),
            otorgado_el: '2026-10-26T12:00:00Z',
            revocado: false,
          },
        },
        terms,
      ),
    ).toBe(false);
  });
});
describe('Durable device revocation and environment settings', () => {
  it('cancels queued A registrations rather than rebinding them to a newly signed-in B', async () => {
    const h = harness();
    let release!: () => void;
    const sentOwners: string[] = [];
    const transport: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/push-token')) {
        sentOwners.push((init?.headers as Record<string, string>).authorization);
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return h.fake(input, init);
    };
    const session = new HttpSessionAdapter({
      config,
      vault: h.vault,
      fetch: transport,
      newId: randomUUID,
    });
    await session.selectDemoPatient(DEMO_USERS[0].id);
    const devices = new DeviceClient(session);
    const first = devices.register('synthetic-pending-A'),
      second = devices.register('synthetic-queued-A');
    const firstRejected = expect(first).rejects.toMatchObject({ kind: 'changed' }),
      secondRejected = expect(second).rejects.toMatchObject({ kind: 'changed' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await session.logout();
    await session.selectDemoPatient(DEMO_USERS[1].id);
    release();
    await Promise.all([firstRejected, secondRejected]);
    expect(sentOwners).toHaveLength(1);
    expect(sentOwners[0]).toContain(owner);
    expect(session.getCurrentUser()?.id).toBe(other);
  });
  it('persists an offline A revocation and never flushes it with B credentials', async () => {
    const h = harness();
    await login(h);
    const devices = new DeviceClient(h.session),
      id = randomUUID();
    await h.vault.write('device-association-' + owner, JSON.stringify(id));
    h.setExpired();
    h.setRefresh(503);
    await h.session.logout();
    expect(JSON.parse(h.vault.data.get('device-revocations-' + owner)!)).toEqual([{ owner, id }]);
    h.setRefresh(200);
    await login(h, 1);
    await devices.reconcilePending();
    expect(h.vault.data.has('device-revocations-' + owner)).toBe(true);
    expect(
      h.calls
        .filter((v) => v.path.includes('dispositivo/sesiones/'))
        .every((v) => v.token.includes(owner)),
    ).toBe(true);
    await h.session.logout();
    await login(h);
    await devices.reconcilePending();
    expect(h.vault.data.has('device-revocations-' + owner)).toBe(false);
    const sent = h.calls.filter((v) => v.path.includes('dispositivo/sesiones/'));
    expect(sent).toHaveLength(2);
    expect(sent.every((v) => v.token.includes(owner))).toBe(true);
  });
  it('does not treat installation ID or association as an auth session', async () => {
    const h = harness();
    await login(h);
    const devices = new DeviceClient(h.session);
    await devices.revoke(randomUUID());
    expect(h.session.getCurrentUser()?.id).toBe(owner);
    expect(h.vault.data.has('active')).toBe(true);
  });
  it('fails closed with incomplete production config, HTTP and misleading demo issuer', () => {
    expect(sessionConfig({ APP_ENV: 'production' })).toBeNull();
    expect(sessionConfig({ APP_ENV: 'other' })).toBeNull();
    expect(
      sessionConfig({
        APP_ENV: 'demo',
        CLINICAL_URL: 'http://user:password@test',
        GATEWAY_URL: 'http://test',
        AUTH_ISSUER: 'demo',
        AUTH_AUDIENCE: 'authenticated',
      }),
    ).toBeNull();
  });
});
