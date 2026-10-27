import type { GatewayRegistroPush, GatewaySesion, GatewaySesiones } from '@quimiocare/contracts';
import { HttpSessionAdapter } from './http-session-adapter';
import { SessionFailure } from './http-session-types';
import { isUuid, object } from './response-checks';
interface Pending {
  owner: string;
  id: string;
}
function association(value: unknown): GatewaySesion {
  if (
    !object(value) ||
    !isUuid(value.id) ||
    !isUuid(value.instalacion_id) ||
    value.plataforma !== 'android' ||
    !['expo', 'fcm'].includes(String(value.proveedor_push)) ||
    typeof value.activa !== 'boolean' ||
    typeof value.token_registrado !== 'boolean' ||
    !Number.isInteger(value.version) ||
    Number(value.version) < 1 ||
    !['ultima_conexion', 'creado_en', 'actualizado_en'].every(
      (k) => typeof value[k] === 'string' && Number.isFinite(Date.parse(value[k] as string)),
    ) ||
    Object.keys(value).some(
      (k) =>
        ![
          'id',
          'instalacion_id',
          'plataforma',
          'proveedor_push',
          'activa',
          'token_registrado',
          'version',
          'ultima_conexion',
          'creado_en',
          'actualizado_en',
        ].includes(k),
    )
  )
    throw new SessionFailure('invalid');
  return value as unknown as GatewaySesion;
}
export class DeviceClient {
  private pending = Promise.resolve();
  constructor(private readonly session: HttpSessionAdapter) {
    session.onClose(() => this.closeCurrent());
  }
  private owner() {
    const owner = this.session.getCurrentUser()?.id;
    if (!owner) throw new SessionFailure('expired');
    return owner;
  }
  private assert(owner: string) {
    if (this.owner() !== owner) throw new SessionFailure('changed');
  }
  captureContext() {
    return { owner: this.owner(), signal: this.session.getContextSignal() };
  }
  assertContext(context: { owner: string; signal: AbortSignal }) {
    this.assert(context.owner);
    if (context.signal.aborted) throw new SessionFailure('changed');
  }
  private async installation() {
    let id = await this.session.vault.read('installation');
    if (!id) {
      id = this.session.newId();
      await this.session.vault.write('installation', id);
    }
    if (!isUuid(id)) throw new SessionFailure('invalid');
    return id;
  }
  async list(cursor?: string): Promise<GatewaySesiones> {
    const r = await this.session.request(
      'gateway',
      '/api/gateway/dispositivo/sesiones' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
    );
    if (
      r.status !== 200 ||
      !object(r.body) ||
      !Array.isArray(r.body.items) ||
      !(r.body.next_cursor === null || typeof r.body.next_cursor === 'string')
    )
      throw new SessionFailure('invalid');
    return { items: r.body.items.map(association), next_cursor: r.body.next_cursor };
  }
  async revoke(id: string) {
    if (!isUuid(id)) throw new SessionFailure('invalid');
    const r = await this.session.request(
      'gateway',
      '/api/gateway/dispositivo/sesiones/' + id,
      'DELETE',
    );
    if (r.status !== 204 && r.status !== 404)
      throw new SessionFailure(r.status === 409 ? 'conflict' : 'invalid', r.status);
  }
  async reconcilePending() {
    const owner = this.owner(),
      key = 'device-revocations-' + owner,
      raw = await this.session.vault.read(key);
    this.assert(owner);
    const entries = raw ? (JSON.parse(raw) as Pending[]) : [];
    for (const entry of entries) {
      if (entry.owner !== owner || !isUuid(entry.id)) throw new SessionFailure('invalid');
      await this.revoke(entry.id);
      this.assert(owner);
    }
    await this.session.vault.remove(key);
    this.assert(owner);
    return entries.length;
  }
  async register(
    pushToken: string,
    metadata: { modelo?: string; version_app?: string; version_so?: string } = {},
  ): Promise<GatewaySesion> {
    // Serialize token callbacks and manual registration to preserve the same client association UUID.
    const context = this.captureContext();
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    try {
      this.assertContext(context);
      const owner = context.owner,
        key = 'device-association-' + owner;
      await this.reconcilePending();
      this.assertContext(context);
      const installation = await this.installation();
      this.assertContext(context);
      const raw = await this.session.vault.read(key);
      this.assertContext(context);
      let id = raw ? (JSON.parse(raw) as string) : this.session.newId();
      if (!isUuid(id)) throw new SessionFailure('invalid');
      let version: number | undefined;
      if (raw) {
        const r = await this.session.request('gateway', '/api/gateway/dispositivo/sesiones/' + id);
        this.assertContext(context);
        if (r.status === 200 && object(r.body)) {
          const current = association(r.body.sesion);
          if (current.activa) version = current.version;
          else id = this.session.newId();
        } else if (r.status !== 404) throw new SessionFailure('invalid');
      }
      await this.session.vault.write(key, JSON.stringify(id));
      this.assertContext(context);
      const body: GatewayRegistroPush = {
        sesion_id: id,
        instalacion_id: installation,
        token_push: pushToken,
        proveedor_push: 'expo',
        plataforma: 'android',
        ...metadata,
        ...(version ? { version_esperada: version } : {}),
      };
      const r = await this.session.request(
        'gateway',
        '/api/gateway/dispositivo/push-token',
        'POST',
        body,
      );
      this.assertContext(context);
      if (r.status === 409) throw new SessionFailure('conflict', 409);
      if (![200, 201].includes(r.status) || !object(r.body)) throw new SessionFailure('invalid');
      return association(r.body.sesion);
    } finally {
      release();
    }
  }
  private async closeCurrent() {
    const owner = this.owner(),
      key = 'device-association-' + owner,
      raw = await this.session.vault.read(key);
    this.assert(owner);
    if (!raw) return;
    const id = JSON.parse(raw) as string;
    if (!isUuid(id)) throw new SessionFailure('invalid');
    const pendingKey = 'device-revocations-' + owner,
      old = await this.session.vault.read(pendingKey);
    this.assert(owner);
    const entries = old ? (JSON.parse(old) as Pending[]) : [];
    if (!entries.some((e) => e.id === id)) entries.push({ owner, id });
    await this.session.vault.write(pendingKey, JSON.stringify(entries));
    this.assert(owner);
    // The durable owner-bound queue survives an offline logout; B never flushes A's entries.
    try {
      await this.reconcilePending();
      await this.session.vault.remove(key);
    } catch (error) {
      if (error instanceof SessionFailure && error.kind === 'changed') throw error;
    }
  }
  async pendingCount() {
    const owner = this.owner(),
      raw = await this.session.vault.read('device-revocations-' + owner);
    this.assert(owner);
    return raw ? (JSON.parse(raw) as Pending[]).length : 0;
  }
}
