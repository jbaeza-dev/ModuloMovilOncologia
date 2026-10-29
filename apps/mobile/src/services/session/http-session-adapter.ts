import type { SessionAdapter } from './session-adapter';
import type { SessionCredentials, SessionResult, SessionState, SessionUser } from './session-types';
import type { SessionConfig } from './session-config';
import type { CredentialVault } from './credential-vault';
import type { Credentials, IdentityCache, SessionSnapshot } from './http-session-types';
import { SessionFailure } from './http-session-types';
import * as check from './response-checks';
import { DEMO_USERS } from './demo-session-adapter';

export const DEMO_AUTH_IDS = [
  '964d32f1-6941-579f-9f08-b60342194da9',
  '2dcb04f2-a2ad-5ea4-b711-9acd7e570002',
] as const;
export interface SessionOptions {
  config: SessionConfig;
  vault: CredentialVault;
  newId: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  googleLogin?: (signal: AbortSignal) => Promise<unknown>;
}
interface StoredSession {
  scope: string;
  credentials: Credentials;
  identity: IdentityCache | null;
}
export interface SessionRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retryUnauthorized?: boolean;
  preserveServiceErrors?: boolean;
}
function cancelledRequest(): Error {
  const error = new Error('Solicitud cancelada.');
  error.name = 'AbortError';
  return error;
}
export class HttpSessionAdapter implements SessionAdapter {
  readonly config: SessionConfig;
  readonly vault: CredentialVault;
  readonly newId: () => string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private current: Credentials | null = null;
  private epoch = 0;
  private controller = new AbortController();
  private renew: Promise<Credentials> | null = null;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private snapshot: SessionSnapshot = {
    state: 'no_identity',
    user: null,
    identity: null,
    stale: true,
    consent: null,
    terms: null,
    uploadAllowed: false,
    message: null,
    revision: 0,
  };
  private closeHandlers = new Set<() => Promise<void>>();
  private connectorStops = new Set<() => Promise<void>>();
  constructor(private readonly options: SessionOptions) {
    this.config = options.config;
    this.vault = options.vault;
    this.newId = options.newId;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }
  getState(): SessionState {
    return this.snapshot.state;
  }
  getCurrentUser(): SessionUser | null {
    return this.snapshot.user;
  }
  getSnapshot = (): SessionSnapshot => this.snapshot;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  onClose(fn: () => Promise<void>) {
    this.closeHandlers.add(fn);
    return () => {
      this.closeHandlers.delete(fn);
    };
  }
  registerConnector(stop: () => Promise<void>) {
    this.connectorStops.add(stop);
    return () => {
      this.connectorStops.delete(stop);
    };
  }
  private update(patch: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    this.listeners.forEach((fn) => fn());
  }
  private assert(epoch: number, owner?: string) {
    if (this.epoch !== epoch || (owner !== undefined && this.current?.owner !== owner))
      throw new SessionFailure('changed');
  }
  private persist() {
    const value: StoredSession | null = this.current
      ? {
          scope: this.config.scope,
          credentials: { ...this.current },
          identity: this.snapshot.identity,
        }
      : null;
    this.writes = this.writes
      .catch(() => undefined)
      .then(() =>
        value ? this.vault.write('active', JSON.stringify(value)) : this.vault.remove('active'),
      );
    return this.writes;
  }
  private async raw(
    base: string,
    path: string,
    init: RequestInit,
    epoch: number,
    options: SessionRequestOptions = {},
  ): Promise<{ status: number; body: unknown }> {
    const timeoutMs = options.timeoutMs ?? 12000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 130000)
      throw new SessionFailure('invalid');
    const controller = new AbortController(),
      parent = this.controller.signal;
    if (options.signal?.aborted) throw cancelledRequest();
    const abort = () => controller.abort();
    parent.addEventListener('abort', abort, { once: true });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (parent.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);
    try {
      const response = await this.fetcher(base + path, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
        headers: { accept: 'application/json', ...init.headers },
      });
      const text = await response.text();
      this.assert(epoch);
      if (text.length > 262144) throw new SessionFailure('invalid');
      let body: unknown = null;
      if (text) {
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''))
          throw new SessionFailure('invalid');
        try {
          body = JSON.parse(text);
        } catch {
          throw new SessionFailure('invalid');
        }
      }
      return { status: response.status, body };
    } catch (error) {
      this.assert(epoch);
      if (options.signal?.aborted) throw cancelledRequest();
      if (timedOut) throw new SessionFailure('unavailable', 408);
      if (error instanceof SessionFailure) throw error;
      throw new SessionFailure('unavailable');
    } finally {
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  private user(owner: string, name?: string): SessionUser {
    const index = DEMO_AUTH_IDS.indexOf(owner as (typeof DEMO_AUTH_IDS)[number]);
    if (this.config.mode === 'demo' && index < 0) throw new SessionFailure('invalid');
    return {
      id: owner,
      name:
        name ?? (this.config.mode === 'demo' && index >= 0 ? DEMO_USERS[index]!.name : 'Paciente'),
      isDemo: this.config.mode === 'demo',
      localPatientId: this.config.mode === 'demo' ? DEMO_USERS[index]!.id : owner,
    };
  }
  async restore(): Promise<SessionResult> {
    const epoch = this.epoch;
    try {
      const raw = await this.vault.read('active');
      this.assert(epoch);
      if (!raw) return { success: false, state: 'no_identity' };
      const stored = JSON.parse(raw) as StoredSession;
      if (
        stored.scope !== this.config.scope ||
        !check.isUuid(stored.credentials?.owner) ||
        typeof stored.credentials.accessToken !== 'string' ||
        typeof stored.credentials.refreshToken !== 'string' ||
        !Number.isFinite(stored.credentials.expiresAt)
      )
        throw new SessionFailure('invalid');
      if (
        stored.identity &&
        (stored.identity.owner !== stored.credentials.owner ||
          stored.identity.scope !== this.config.scope ||
          stored.identity.user.id !== stored.credentials.owner)
      )
        throw new SessionFailure('invalid');
      if (stored.identity) {
        check.profile(stored.identity.profile, stored.credentials.owner);
        stored.identity.user = this.user(
          stored.credentials.owner,
          stored.identity.profile.nombre ?? undefined,
        );
      }
      this.current = stored.credentials;
      this.update({
        user: stored.identity?.user ?? this.user(stored.credentials.owner),
        identity: stored.identity,
        stale: true,
        state: 'reauthenticating',
      });
      try {
        await this.refreshIdentity();
      } catch (error) {
        if (error instanceof SessionFailure && error.kind === 'changed') throw error;
        this.markFailure(error);
      }
      return {
        success: !!this.snapshot.identity && this.getState() !== 'access_denied',
        user: this.snapshot.user!,
        state: this.getState(),
      };
    } catch (error) {
      if (error instanceof SessionFailure && error.kind === 'changed')
        return { success: false, state: this.getState() };
      this.current = null;
      this.update({
        state: 'no_identity',
        user: null,
        identity: null,
        consent: null,
        terms: null,
        uploadAllowed: false,
        stale: true,
        message:
          'No se pudo recuperar la sesión. Vuelve a autenticarte; tus capturas se conservan.',
      });
      return { success: false, state: 'no_identity' };
    }
  }
  async selectDemoPatient(patientId: string): Promise<SessionResult> {
    if (this.config.mode !== 'demo') return { success: false, state: 'unconfigured' };
    const index = DEMO_USERS.findIndex(
      (u) => u.id === patientId || DEMO_AUTH_IDS[DEMO_USERS.indexOf(u)] === patientId,
    );
    if (index < 0)
      return { success: false, state: this.getState(), error: 'Paciente de prueba no reconocido.' };
    return this.establish(async (epoch) => {
      const r = await this.raw(
        this.config.authUrl,
        '/__demo/auth/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paciente_demo: index === 0 ? 'A' : 'B' }),
        },
        epoch,
      );
      if (r.status !== 200) throw new SessionFailure('unavailable');
      const value = check.credentials(r.body, this.now());
      if (value.owner !== DEMO_AUTH_IDS[index]) throw new SessionFailure('invalid');
      return value;
    });
  }
  async login(_credentials: SessionCredentials): Promise<SessionResult> {
    void _credentials;
    if (this.config.mode !== 'production' || !this.options.googleLogin)
      return {
        success: false,
        state: 'unconfigured',
        error: 'El proveedor central de Google no está configurado.',
      };
    return this.establish(async (epoch) => {
      const value = await this.options.googleLogin!(this.controller.signal);
      this.assert(epoch);
      return check.credentials(value, this.now());
    });
  }
  private async establish(issue: (epoch: number) => Promise<Credentials>): Promise<SessionResult> {
    this.controller.abort();
    this.controller = new AbortController();
    const epoch = ++this.epoch;
    this.renew = null;
    await this.stopConnectors();
    this.assert(epoch);
    this.current = null;
    this.update({
      state: 'authenticating',
      user: null,
      identity: null,
      consent: null,
      terms: null,
      uploadAllowed: false,
      stale: true,
      message: null,
    });
    try {
      const issued = await issue(epoch);
      this.assert(epoch);
      this.current = issued;
      this.update({ user: this.user(issued.owner) });
      await this.persist();
      this.assert(epoch);
      await this.refreshIdentity();
      this.assert(epoch);
      return {
        success: !!this.snapshot.identity && this.getState() !== 'access_denied',
        state: this.getState(),
        user: this.snapshot.user!,
      };
    } catch (error) {
      if (error instanceof SessionFailure && error.kind === 'changed')
        return { success: false, state: this.getState() };
      this.markFailure(error);
      return {
        success: false,
        state: this.getState(),
        error:
          error instanceof SessionFailure ? error.message : 'No fue posible iniciar la sesión.',
      };
    }
  }
  private markFailure(error: unknown) {
    const kind = error instanceof SessionFailure ? error.kind : 'unavailable';
    this.update({
      state:
        kind === 'expired'
          ? 'expired'
          : kind === 'denied'
            ? 'access_denied'
            : 'service_unavailable',
      stale: true,
      uploadAllowed: false,
      message:
        error instanceof SessionFailure
          ? error.message
          : 'Servicio no disponible. Tus datos locales se conservan.',
    });
  }
  async accessToken(failedToken?: string): Promise<string> {
    const current = this.current;
    if (!current) throw new SessionFailure('expired');
    if (
      (failedToken && failedToken !== current.accessToken) ||
      (!failedToken && current.expiresAt > this.now() + 30000)
    )
      return current.accessToken;
    if (!this.renew) {
      const epoch = this.epoch,
        owner = current.owner;
      this.update({ state: 'renewing', uploadAllowed: false });
      const promise = (async () => {
        try {
          const demo = this.config.mode === 'demo';
          const r = await this.raw(
            this.config.authUrl,
            demo ? '/__demo/auth/refresh' : '/token?grant_type=refresh_token',
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(!demo ? { apikey: this.config.publicKey! } : {}),
              },
              body: JSON.stringify({ refresh_token: current.refreshToken }),
            },
            epoch,
          );
          this.assert(epoch, owner);
          if (r.status === 401 || r.status === 400) throw new SessionFailure('expired');
          if (r.status !== 200) throw new SessionFailure('unavailable');
          const next = check.credentials(r.body, this.now());
          if (next.owner !== owner) throw new SessionFailure('invalid');
          this.current = next;
          await this.persist();
          this.assert(epoch, owner);
          this.update({
            state: this.snapshot.consent?.requiere_aceptacion ? 'terms_pending' : 'context_ready',
            uploadAllowed: false,
          });
          return next;
        } catch (error) {
          this.assert(epoch, owner);
          this.markFailure(error);
          throw error;
        }
      })();
      this.renew = promise;
      void promise
        .finally(() => {
          if (this.renew === promise) this.renew = null;
        })
        .catch(() => undefined);
    }
    return (await this.renew).accessToken;
  }
  async request(
    service: 'clinical' | 'gateway',
    path: string,
    method = 'GET',
    body?: unknown,
    options: SessionRequestOptions = {},
  ): Promise<{ status: number; body: unknown }> {
    if (!this.current) throw new SessionFailure('expired');
    if (!/^\/[A-Za-z0-9_/?=&%.-]*$/.test(path) || path.startsWith('//') || path.includes('..'))
      throw new SessionFailure('invalid');
    const epoch = this.epoch,
      owner = this.current.owner,
      serialized = body === undefined ? undefined : JSON.stringify(body);
    const base = service === 'clinical' ? this.config.clinicalUrl : this.config.gatewayUrl;
    const invoke = (token: string) =>
      this.raw(
        base,
        path,
        {
          method,
          headers: {
            authorization: 'Bearer ' + token,
            ...(serialized !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(serialized !== undefined ? { body: serialized } : {}),
        },
        epoch,
        options,
      );
    try {
      const token = await this.accessToken();
      this.assert(epoch, owner);
      if (options.signal?.aborted) throw cancelledRequest();
      let r = await invoke(token);
      this.assert(epoch, owner);
      if (r.status === 401 && options.retryUnauthorized !== false) {
        const refreshed = await this.accessToken(token);
        this.assert(epoch, owner);
        r = await invoke(refreshed);
        this.assert(epoch, owner);
      }
      if (r.status === 401) throw new SessionFailure('expired', 401);
      if (r.status === 403) throw new SessionFailure('denied', 403);
      if (!options.preserveServiceErrors && (r.status >= 500 || r.status === 429))
        throw new SessionFailure('unavailable', r.status);
      return r;
    } catch (error) {
      this.assert(epoch, owner);
      if (
        error instanceof SessionFailure &&
        (['expired', 'denied'].includes(error.kind) ||
          (error.kind === 'unavailable' && !options.preserveServiceErrors))
      )
        this.markFailure(error);
      throw error;
    }
  }
  async refreshIdentity(): Promise<void> {
    const epoch = this.epoch,
      owner = this.current?.owner;
    if (!owner) throw new SessionFailure('expired');
    this.update({ uploadAllowed: false });
    try {
      const r = await this.request('clinical', '/api/v1/auth/me');
      if (r.status !== 200) throw new SessionFailure('unavailable');
      const profile = check.profile(r.body, owner);
      if (!profile.activo || profile.rol !== 'paciente') throw new SessionFailure('denied');
      const user = this.user(owner, profile.nombre ?? undefined),
        complete = profile.estado_incorporacion === 'COMPLETO';
      const readOptional = async (path: string, kind: 'clinical' | 'treatment') => {
        try {
          const r = await this.request('clinical', path);
          if (r.status === 404) return { status: 'missing' as const, value: null };
          if (r.status !== 200) throw new SessionFailure('invalid');
          return {
            status: 'available' as const,
            value: kind === 'clinical' ? check.clinicalProfile(r.body) : check.treatment(r.body),
          };
        } catch (error) {
          if (
            error instanceof SessionFailure &&
            ['changed', 'expired', 'denied'].includes(error.kind)
          )
            throw error;
          return { status: 'unavailable' as const, value: null };
        }
      };
      const [clinical, treatment] = complete
        ? await Promise.all([
            readOptional('/api/v1/pacientes/me/perfil-clinico', 'clinical'),
            readOptional('/api/v1/pacientes/me/tratamiento-activo', 'treatment'),
          ])
        : [
            { status: 'missing' as const, value: null },
            { status: 'missing' as const, value: null },
          ];
      this.assert(epoch, owner);
      const identity: IdentityCache = {
        owner,
        scope: this.config.scope,
        fetchedAt:
          clinical.status === 'unavailable' || treatment.status === 'unavailable'
            ? (this.snapshot.identity?.fetchedAt ?? new Date(this.now()).toISOString())
            : new Date(this.now()).toISOString(),
        user,
        profile,
        clinicalProfile: (clinical.status === 'unavailable'
          ? (this.snapshot.identity?.clinicalProfile ?? null)
          : clinical.value) as IdentityCache['clinicalProfile'],
        treatment: (treatment.status === 'unavailable'
          ? (this.snapshot.identity?.treatment ?? null)
          : treatment.value) as IdentityCache['treatment'],
        clinicalStatus: clinical.status,
        treatmentStatus: treatment.status,
      };
      this.update({
        identity,
        user,
        stale: clinical.status === 'unavailable' || treatment.status === 'unavailable',
        state: complete ? 'context_ready' : 'profile_incomplete',
        message: complete ? null : 'Completa tus datos para habilitar las operaciones online.',
      });
      await this.persist();
      this.assert(epoch, owner);
      if (complete) await this.refreshConsent();
    } catch (error) {
      this.assert(epoch, owner);
      this.markFailure(error);
      throw error;
    }
  }
  async completeProfile(body: {
    rut: string;
    telefono?: string | null;
    fecha_nacimiento?: string | null;
    sexo?: string | null;
  }) {
    if (
      !body.rut ||
      Object.keys(body).some((k) => !['rut', 'telefono', 'fecha_nacimiento', 'sexo'].includes(k))
    )
      throw new SessionFailure('invalid');
    const r = await this.request(
      'clinical',
      '/api/v1/auth/completar-perfil-paciente',
      'POST',
      body,
    );
    if (r.status !== 200)
      throw new SessionFailure(r.status === 409 ? 'conflict' : 'invalid', r.status);
    check.profile(r.body, this.current!.owner);
    await this.refreshIdentity();
  }
  async publicTerms() {
    const epoch = this.epoch;
    const path = '/api/v1/terminos/vigente?codigo=TERMINOS_PLATAFORMA';
    const r = this.current
      ? await this.request('clinical', path)
      : await this.raw(this.config.clinicalUrl, path, { method: 'GET' }, epoch);
    if (r.status !== 200) throw new SessionFailure('unavailable', r.status);
    const terms = check.terms(r.body);
    this.update({ terms });
    return terms;
  }
  async refreshConsent(): Promise<void> {
    const epoch = this.epoch,
      owner = this.current?.owner;
    if (!owner) throw new SessionFailure('expired');
    this.update({ uploadAllowed: false });
    try {
      const [terms, r] = await Promise.all([
        this.publicTerms(),
        this.request('clinical', '/api/v1/pacientes/me/consentimientos?codigo=TERMINOS_PLATAFORMA'),
      ]);
      this.assert(epoch, owner);
      if (r.status !== 200) throw new SessionFailure('invalid');
      const consent = check.consentState(r.body, owner);
      const allowed =
        check.canUpload(consent, terms) &&
        !this.snapshot.stale &&
        this.snapshot.identity?.profile.estado_incorporacion === 'COMPLETO' &&
        this.snapshot.identity.clinicalStatus === 'available' &&
        this.snapshot.identity.treatmentStatus === 'available' &&
        this.snapshot.identity.treatment?.tipo_tratamiento_codigo === 'quimioterapia';
      this.update({
        terms,
        consent,
        uploadAllowed: allowed,
        state: allowed
          ? 'context_ready'
          : check.canUpload(consent, terms)
            ? 'clinical_incomplete'
            : 'terms_pending',
        message: allowed
          ? null
          : !check.canUpload(consent, terms)
            ? 'Los envíos están pausados hasta confirmar los términos vigentes. Puedes conservar capturas y consultar tu historia.'
            : 'Falta verificar el contexto clínico en el servidor. Puedes conservar capturas y consultar tu historia.',
      });
    } catch (error) {
      this.assert(epoch, owner);
      this.markFailure(error);
      throw error;
    }
  }
  async acceptTerms(): Promise<void> {
    const owner = this.current?.owner,
      terms = this.snapshot.terms,
      epoch = this.epoch;
    if (!owner || !terms) throw new SessionFailure('expired');
    const key = 'consent-operation-' + owner,
      stored = await this.vault.read(key);
    this.assert(epoch, owner);
    let operation = stored
      ? (JSON.parse(stored) as { definition: string; operation: string })
      : null;
    if (!operation || operation.definition !== terms.id)
      operation = { definition: terms.id, operation: this.newId() };
    await this.vault.write(key, JSON.stringify(operation));
    this.assert(epoch, owner);
    const r = await this.request('clinical', '/api/v1/pacientes/me/consentimientos', 'POST', {
      definicion_terminos_id: operation.definition,
      operacion_id: operation.operation,
      codigo: 'TERMINOS_PLATAFORMA',
    });
    if (r.status !== 200 && r.status !== 201) {
      await this.refreshConsent();
      throw new SessionFailure(r.status === 409 ? 'conflict' : 'invalid', r.status);
    }
    const actual = r.body;
    if (
      !check.object(actual) ||
      actual.paciente_id !== owner ||
      typeof actual.revocado !== 'boolean'
    )
      throw new SessionFailure('invalid');
    // A 200 replay can describe a revoked act. Only a fresh C-15 may reopen uploads.
    await this.refreshConsent();
    this.assert(epoch, owner);
    await this.vault.remove(key);
    this.assert(epoch, owner);
    if (!this.snapshot.uploadAllowed) throw new SessionFailure('denied');
  }
  async credentialsForSync(): Promise<{
    token: string;
    expiresAt: Date;
    owner: string;
    signal: AbortSignal;
  }> {
    const epoch = this.epoch,
      owner = this.current?.owner;
    if (!owner) throw new SessionFailure('expired');
    await this.refreshConsent();
    this.assert(epoch, owner);
    if (!this.snapshot.uploadAllowed) throw new SessionFailure('denied');
    const token = await this.accessToken();
    this.assert(epoch, owner);
    return {
      token,
      expiresAt: new Date(this.current!.expiresAt),
      owner,
      signal: this.controller.signal,
    };
  }
  getContextSignal(): AbortSignal {
    return this.controller.signal;
  }
  cancelRequests(): void {
    this.controller.abort();
    this.controller = new AbortController();
    ++this.epoch;
    this.renew = null;
    this.update({ uploadAllowed: false });
  }
  private async stopConnectors() {
    await Promise.all([...this.connectorStops].map((stop) => stop()));
  }
  async logout(): Promise<void> {
    this.controller.abort();
    this.controller = new AbortController();
    ++this.epoch;
    this.renew = null;
    this.update({ state: 'closing', uploadAllowed: false });
    await this.stopConnectors();
    // Durable revocations use the outgoing identity before credentials are removed.
    for (const close of this.closeHandlers) await close();
    this.controller.abort();
    this.controller = new AbortController();
    ++this.epoch;
    this.current = null;
    this.update({
      state: 'no_identity',
      user: null,
      identity: null,
      consent: null,
      terms: null,
      uploadAllowed: false,
      stale: true,
      message: null,
    });
    await this.persist();
  }
}
