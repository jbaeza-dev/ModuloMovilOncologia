import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HttpSessionAdapter } from './http-session-adapter';
import { DeviceClient } from './device-client';
import { sessionConfig } from './session-config';
import type { CredentialVault } from './credential-vault';
import { canUpload } from './response-checks';
const owner = '964d32f1-6941-579f-9f08-b60342194da9',
  other = '2dcb04f2-a2ad-5ea4-b711-9acd7e570002';
const config = sessionConfig({
  APP_ENV: 'universidad-demo',
  CLINICAL_URL: 'https://clinical.test',
  GATEWAY_URL: 'https://gateway.test',
  AUTH_URL: 'https://auth.test',
  AUTH_ISSUER: 'https://auth.test',
  AUTH_AUDIENCE: 'authenticated',
  AUTH_PUBLIC_KEY: 'synthetic-public-key',
  AUTH_REDIRECT_URI: 'quimiocare://acceso/oauth',
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
    nextIdentity = owner as string,
    generation = 0,
    expired = false,
    refreshStatus = 200,
    consentRequired = false,
    revoked = false,
    dropAccept = false,
    profileStatus = 200,
    treatmentStatus = 200,
    clinicalStatus = 200,
    incorporation = 'COMPLETO';
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
        user: { id: identity },
      };
    }
    if (path === '/google') {
      identity = nextIdentity;
      generation++;
      expired = false;
      return response(creds());
    }
    if (path === '/token') {
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
          estado_incorporacion: incorporation,
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
  // Simula la vuelta de Google con la cuenta elegida por la prueba.
  const googleLogin = async () =>
    (await fake('https://auth.test/google', { method: 'POST' })).json();
  const session = new HttpSessionAdapter({
    config,
    vault,
    fetch: fake,
    newId: randomUUID,
    googleLogin,
  });
  return {
    session,
    googleLogin,
    useAccount: (index: number) => {
      nextIdentity = index === 0 ? owner : other;
    },
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
    setIncorporation: (v: string) => {
      incorporation = v;
    },
    setDelay: (v: () => Promise<void>) => {
      delay = v;
    },
  };
}
const login = (h: ReturnType<typeof harness>, index = 0) => {
  h.useAccount(index);
  return h.session.login({});
};
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
    saved.identity.user.localPatientId = randomUUID();
    await h.vault.write('active', JSON.stringify(saved));
    const restored = new HttpSessionAdapter({
      config,
      vault: h.vault,
      fetch: h.fake,
      newId: randomUUID,
    });
    expect((await restored.restore()).success).toBe(true);
    expect(restored.getCurrentUser()?.localPatientId).toBe(owner);
  });
  it('maps Auth UUID independently from preserved local identity, profile and treatment', async () => {
    const h = harness();
    expect((await login(h)).success).toBe(true);
    const s = h.session.getSnapshot();
    expect(s.user).toMatchObject({ id: owner, localPatientId: owner, isDemo: false });
    expect(s.identity?.clinicalProfile?.id).toBe(profileId);
    expect(s.identity?.treatment?.id).toBe(treatmentId);
    expect(s.uploadAllowed).toBe(true);
    expect(JSON.parse(h.vault.data.get('active')!).credentials.owner).toBe(owner);
  });
  it('restores the same account after a new adapter instance without signing in with Google again', async () => {
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
    expect(h.calls.filter((v) => v.path === '/google')).toHaveLength(1);
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
    expect(h.calls.filter((v) => v.path === '/token')).toHaveLength(1);
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
  describe('la renovación del token conserva el estado real de la sesión', () => {
    async function renew(h: ReturnType<typeof harness>) {
      h.setExpired();
      const result = await h.session.request('clinical', '/capture', 'POST', { id: randomUUID() });
      expect(result.status).toBe(200);
      expect(h.calls.filter((v) => v.path === '/token')).toHaveLength(1);
    }
    it('un perfil incompleto sigue pidiendo completar los datos', async () => {
      const h = harness();
      h.setIncorporation('PENDIENTE');
      await login(h);
      expect(h.session.getState()).toBe('profile_incomplete');
      await renew(h);
      expect(h.session.getState()).toBe('profile_incomplete');
      expect(h.session.getSnapshot().uploadAllowed).toBe(false);
    });
    it('un tratamiento sin vincular sigue pendiente de vinculación', async () => {
      const h = harness();
      h.setTreatment(404);
      await login(h);
      expect(h.session.getState()).toBe('clinical_incomplete');
      await renew(h);
      expect(h.session.getState()).toBe('clinical_incomplete');
    });
    it('los términos pendientes siguen pendientes', async () => {
      const h = harness();
      h.setConsent(true);
      await login(h);
      expect(h.session.getState()).toBe('terms_pending');
      await renew(h);
      expect(h.session.getState()).toBe('terms_pending');
    });
    it('un servicio no disponible no se presenta como sesión lista', async () => {
      const h = harness();
      await login(h);
      h.setProfile(503);
      await expect(h.session.refreshIdentity()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(h.session.getState()).toBe('service_unavailable');
      await renew(h);
      expect(h.session.getState()).toBe('service_unavailable');
    });
    it('tras una renovación fallida, la siguiente recalcula el estado desde lo ya leído', async () => {
      const h = harness();
      h.setIncorporation('PENDIENTE');
      await login(h);
      h.setExpired();
      h.setRefresh(401);
      await expect(
        h.session.request('clinical', '/capture', 'POST', { id: randomUUID() }),
      ).rejects.toMatchObject({ kind: 'expired' });
      expect(h.session.getState()).toBe('expired');
      h.setRefresh(200);
      expect(
        (await h.session.request('clinical', '/capture', 'POST', { id: randomUUID() })).status,
      ).toBe(200);
      expect(h.session.getState()).toBe('profile_incomplete');
    });
    it('una sesión completa vuelve a quedar lista, sin habilitar envíos hasta revalidar', async () => {
      const h = harness();
      await login(h);
      expect(h.session.getState()).toBe('context_ready');
      await renew(h);
      expect(h.session.getState()).toBe('context_ready');
      expect(h.session.getSnapshot().uploadAllowed).toBe(false);
    });
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
  it('never reuses credentials or identity when APP_ENV or service scope changes', async () => {
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
  it('confirms consent before linkage without enabling sync, then enables it after context arrives', async () => {
    const h = harness();
    h.setConsent(true);
    h.setClinical(404);
    h.setTreatment(404);
    await login(h);
    await expect(h.session.acceptTerms()).resolves.toBeUndefined();
    expect(h.session.getState()).toBe('clinical_incomplete');
    expect(h.session.getSnapshot().uploadAllowed).toBe(false);
    await expect(h.session.credentialsForSync()).rejects.toMatchObject({ kind: 'denied' });
    h.setClinical(200);
    h.setTreatment(200);
    await h.session.refreshIdentity();
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
    await expect(h.session.credentialsForSync()).resolves.toMatchObject({ owner });
  });
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
      googleLogin: h.googleLogin,
    });
    h.useAccount(0);
    await session.login({});
    const devices = new DeviceClient(session);
    const first = devices.register('synthetic-pending-A'),
      second = devices.register('synthetic-queued-A');
    const firstRejected = expect(first).rejects.toMatchObject({ kind: 'changed' }),
      secondRejected = expect(second).rejects.toMatchObject({ kind: 'changed' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await session.logout();
    h.useAccount(1);
    await session.login({});
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
  it('fails closed with incomplete production config, HTTP, credentials in URLs and the retired demo mode', () => {
    const complete = {
      CLINICAL_URL: 'https://clinical.test',
      GATEWAY_URL: 'https://gateway.test',
      AUTH_URL: 'https://auth.test',
      AUTH_ISSUER: 'https://auth.test',
      AUTH_AUDIENCE: 'authenticated',
      AUTH_PUBLIC_KEY: 'synthetic-public-key',
      AUTH_REDIRECT_URI: 'quimiocare://acceso/oauth',
    };
    expect(sessionConfig({ APP_ENV: 'production' })).toBeNull();
    expect(sessionConfig({ APP_ENV: 'other' })).toBeNull();
    expect(sessionConfig({ ...complete, APP_ENV: 'demo' })).toBeNull();
    expect(sessionConfig({ ...complete, APP_ENV: 'production' })).not.toBeNull();
    expect(
      sessionConfig({ ...complete, APP_ENV: 'production', CLINICAL_URL: 'http://clinical.test' }),
    ).toBeNull();
    expect(
      sessionConfig({
        ...complete,
        APP_ENV: 'universidad-demo',
        CLINICAL_URL: 'https://user:password@clinical.test',
      }),
    ).toBeNull();
    expect(
      sessionConfig({ ...complete, APP_ENV: 'production', AUTH_ISSUER: 'demo', AUTH_URL: 'demo' }),
    ).toBeNull();
  });
});

describe('Código de diagnóstico cuando el acceso no está disponible', () => {
  const adapterWith = (
    h: ReturnType<typeof harness>,
    fetcher: typeof fetch,
    googleLogin = h.googleLogin,
  ) =>
    new HttpSessionAdapter({
      config,
      vault: new Vault(),
      fetch: fetcher,
      newId: randomUUID,
      googleLogin,
    });
  it('un 503 de QuimioCare queda como Q-503 y se borra al volver a entrar bien', async () => {
    const h = harness();
    h.setProfile(503);
    expect((await login(h)).success).toBe(false);
    expect(h.session.getSnapshot()).toMatchObject({
      state: 'service_unavailable',
      failureCode: 'Q-503',
    });
    h.setProfile(200);
    expect((await login(h)).success).toBe(true);
    expect(h.session.getSnapshot().failureCode).toBeNull();
  });
  it('sin respuesta de QuimioCare queda como Q-RED', async () => {
    const h = harness();
    const session = adapterWith(h, async (input, init) => {
      if (new URL(String(input)).pathname === '/api/v1/auth/me')
        throw new TypeError('Network request failed');
      return h.fake(input, init);
    });
    await session.login({});
    expect(session.getSnapshot().failureCode).toBe('Q-RED');
  });
  it('una espera de más de 12 s en QuimioCare queda como Q-ESPERA', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const session = adapterWith(h, (input, init) =>
        new URL(String(input)).pathname === '/api/v1/auth/me'
          ? new Promise((_resolve, reject) =>
              init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
            )
          : h.fake(input, init),
      );
      const pending = session.login({});
      await vi.advanceTimersByTimeAsync(12000);
      await pending;
      expect(session.getSnapshot().failureCode).toBe('Q-ESPERA');
    } finally {
      vi.useRealTimers();
    }
  });
  it('un error inesperado solo muestra su tipo, nunca su texto', async () => {
    const h = harness();
    const session = adapterWith(h, h.fake, async () => {
      throw new TypeError('detalle interno con datos');
    });
    await session.login({});
    expect(session.getSnapshot()).toMatchObject({
      state: 'service_unavailable',
      failureCode: 'INTERNO-TypeError',
    });
  });
  it('credenciales incompatibles de Supabase quedan como G-INCOMPATIBLE', async () => {
    const h = harness();
    const session = adapterWith(h, h.fake, async () => ({ token_type: 'bearer' }));
    await session.login({});
    expect(session.getSnapshot().failureCode).toBe('G-INCOMPATIBLE');
  });
});
describe('Actualización automática y concurrente de identidad', () => {
  it('comparte una sola verificación entre varios disparadores y deja permisos confirmados', async () => {
    const h = harness();
    await login(h);
    h.calls.splice(0);
    await Promise.all([
      h.session.refreshIdentity(),
      h.session.refreshIdentity(),
      h.session.refreshIdentity(),
    ]);
    expect(h.calls.filter((call) => call.path === '/api/v1/auth/me')).toHaveLength(1);
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
  });
  it('el SDK recupera el perfil obsoleto al volver el servidor, sin pedir una actualización manual', async () => {
    const h = harness();
    await login(h);
    h.setProfile(503);
    await expect(h.session.refreshIdentity()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(h.session.getSnapshot().stale).toBe(true);
    h.setProfile(200);
    const credentials = await h.session.credentialsForSync();
    expect(credentials.owner).toBe(owner);
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
    expect(h.session.getSnapshot().stale).toBe(false);
  });
  it('con el servidor caído, los pedidos de credenciales de PowerSync esperan antes de volver a consultar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
      const h = harness();
      await login(h);
      h.setProfile(503);
      await expect(h.session.refreshIdentity()).rejects.toMatchObject({ kind: 'unavailable' });
      const me = () => h.calls.filter((call) => call.path === '/api/v1/auth/me').length;
      h.calls.splice(0);
      // El primer pedido consulta; los siguientes, dentro de la espera, no salen a la red.
      await expect(h.session.credentialsForSync()).rejects.toMatchObject({ kind: 'unavailable' });
      await expect(h.session.credentialsForSync()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(me()).toBe(1);
      vi.setSystemTime(new Date('2026-11-26T12:00:04Z'));
      await expect(h.session.credentialsForSync()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(me()).toBe(1);
      // Pasados 5 s consulta otra vez, y la espera siguiente crece a 15 s.
      vi.setSystemTime(new Date('2026-11-26T12:00:06Z'));
      await expect(h.session.credentialsForSync()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(me()).toBe(2);
      vi.setSystemTime(new Date('2026-11-26T12:00:16Z'));
      await expect(h.session.credentialsForSync()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(me()).toBe(2);
      // Una consulta directa (recuperación automática o «Intentar ahora») siempre sale y, si
      // funciona, levanta la espera.
      h.setProfile(200);
      await h.session.refreshIdentity();
      expect(me()).toBe(3);
      const credentials = await h.session.credentialsForSync();
      expect(credentials.owner).toBe(owner);
      expect(h.session.getSnapshot().uploadAllowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('una actualización cancelada no reemplaza la nueva verificación del mismo contexto', async () => {
    const h = harness();
    await login(h);
    const old = h.session.refreshIdentity();
    const refused = expect(old).rejects.toMatchObject({ kind: 'changed' });
    h.session.cancelRequests();
    const current = h.session.refreshIdentity();
    await refused;
    await current;
    expect(h.session.getSnapshot().user?.id).toBe(owner);
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
  });
});

describe('Verificación posterior al guardado de perfil', () => {
  it('no usa una consulta anterior al guardado aunque la recuperación automática siga en curso', async () => {
    const h = harness();
    await login(h);
    const profile = h.session.getSnapshot().identity!.profile;
    const original = vi.mocked(h.fake).getMockImplementation()!;
    let reads = 0,
      saved = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const response = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    vi.mocked(h.fake).mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/auth/completar-perfil-paciente') {
        saved = true;
        return response({ ...profile, nombre: 'Nombre actualizado' });
      }
      if (path === '/api/v1/auth/me') {
        reads++;
        const name = saved ? 'Nombre actualizado' : 'Nombre anterior';
        if (reads === 1) await pending;
        return response({ ...profile, nombre: name });
      }
      return original(input, init);
    });
    const automatic = h.session.refreshIdentity();
    await vi.waitFor(() => expect(reads).toBe(1));
    const update = h.session.completeProfile({ rut: '11.111.111-1' });
    await vi.waitFor(() => expect(saved).toBe(true));
    release();
    await Promise.all([automatic, update]);
    expect(reads).toBe(2);
    expect(h.session.getSnapshot().identity?.profile.nombre).toBe('Nombre actualizado');
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
  });

  it('permite revocar manualmente la asociación push del dispositivo actual al desactivar avisos en configuración', async () => {
    const h = harness();
    await login(h);
    const devices = new DeviceClient(h.session);
    const id = randomUUID();
    await h.vault.write('device-association-' + owner, JSON.stringify(id));
    await devices.revokeCurrentDevice();
    expect(await devices.pendingCount()).toBe(0);
    expect(await h.vault.read('device-association-' + owner)).toBeNull();
    expect(h.session.getCurrentUser()?.id).toBe(owner);
    expect(h.calls.some((v) => v.path.includes(`dispositivo/sesiones/${id}`))).toBe(true);
  });

  it('mantiene uploadAllowed activo mientras credentialsForSync revalida consentimiento en segundo plano', async () => {
    const h = harness();
    await login(h);
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
    const pendingCredentials = h.session.credentialsForSync();
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
    await expect(pendingCredentials).resolves.toMatchObject({ owner });
    expect(h.session.getSnapshot().uploadAllowed).toBe(true);
  });
});
