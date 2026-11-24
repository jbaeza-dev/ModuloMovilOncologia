import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteTestHarness } from '../../data/local/testing/sqlite-test-harness';
import { migrateDatabase } from '../../data/local/migrations';
import { createLinkCodeClient } from './link-code-client';
import { SessionFailure } from './http-session-types';

const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const owner = '964d32f1-6941-579f-9f08-b60342194da9';
const start = Date.parse('2026-10-27T23:00:00Z');
async function setup() {
  const db = harness.open();
  await migrateDatabase(db);
  let clock = start;
  let online = true;
  let activeOwner = owner;
  const controller = new AbortController();
  const request = vi.fn(async () => ({
    status: 201,
    body: { codigo: 'A-Bc_opaque', fecha_expiracion: new Date(clock + 86_400_000).toISOString() },
  }));
  const session = {
    getCurrentUser: () => ({ id: activeOwner, name: 'Synthetic', isDemo: true }),
    getContextSignal: () => controller.signal,
    request,
  };
  return {
    db,
    request,
    session,
    controller,
    client: createLinkCodeClient(
      db,
      session,
      owner,
      () => clock,
      async () => online,
    ),
    setClock: (value: number) => {
      clock = value;
    },
    setOnline: (value: boolean) => {
      online = value;
    },
    changeOwner: () => {
      activeOwner = 'other';
    },
    reopen: () =>
      createLinkCodeClient(
        db,
        session,
        owner,
        () => clock,
        async () => online,
      ),
  };
}
describe('C05: server authority and encrypted scoped copy', () => {
  it('preserves the opaque code across clients/reopen without a GET or another POST', async () => {
    const s = await setup();
    expect(await s.client.read()).toEqual({ kind: 'empty' });
    const code = await s.client.generate();
    expect(code).toMatchObject({ kind: 'known', code: 'A-Bc_opaque' });
    expect(await s.reopen().read()).toEqual(code);
    expect(await s.reopen().generate()).toEqual(code);
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.request).toHaveBeenCalledWith(
      'clinical',
      '/api/v1/pacientes/me/codigo-vinculacion',
      'POST',
    );
  });
  it('serializes concurrent clients before issuing the side effect', async () => {
    const s = await setup();
    await Promise.all([s.client.generate(), s.reopen().generate()]);
    expect(s.request).toHaveBeenCalledTimes(1);
  });
  it('conserva la incertidumbre tras una respuesta perdida y al reabrir, y el reintento la resuelve', async () => {
    const s = await setup();
    s.request.mockRejectedValueOnce(new Error('response lost after issuance'));
    await expect(s.client.generate()).rejects.toThrow();
    const uncertain = await s.reopen().read();
    expect(uncertain).toMatchObject({ kind: 'uncertain' });
    expect(await s.reopen().read()).toEqual(uncertain);
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(await s.reopen().generate()).toMatchObject({ kind: 'known' });
    expect(s.request).toHaveBeenCalledTimes(2);
  });
  it('expires a known copy exactly at the returned deadline', async () => {
    const s = await setup();
    await s.client.generate();
    s.setClock(start + 86_400_000 - 1);
    await s.client.generate();
    expect(s.request).toHaveBeenCalledTimes(1);
    s.setClock(start + 86_400_000);
    await s.client.generate();
    expect(s.request).toHaveBeenCalledTimes(2);
  });
  it('trata un 409 como incierto sin inventar un código, y un reintento posterior puede resolverlo', async () => {
    const s = await setup();
    s.request.mockResolvedValueOnce({ status: 409, body: null } as never);
    expect(await s.client.generate()).toMatchObject({ kind: 'uncertain', conflict: true });
    expect(await s.reopen().read()).toMatchObject({ kind: 'uncertain', conflict: true });
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(await s.reopen().generate()).toMatchObject({ kind: 'known' });
    expect(s.request).toHaveBeenCalledTimes(2);
  });
  it('does not save a malformed response as a valid code', async () => {
    const s = await setup();
    s.request.mockResolvedValueOnce({ status: 201, body: { codigo: '', fecha_expiracion: 'bad' } });
    await expect(s.client.generate()).rejects.toThrow();
    expect(await s.client.read()).toMatchObject({ kind: 'uncertain' });
  });
  it('rejects the old account context before reading or posting', async () => {
    const s = await setup();
    await s.client.generate();
    s.changeOwner();
    await expect(s.client.read()).rejects.toThrow('cuenta cambió');
    await expect(s.client.generate()).rejects.toThrow('cuenta cambió');
    expect(s.request).toHaveBeenCalledTimes(1);
  });
  it('sin conexión no envía nada ni reserva, y permite pedirlo apenas vuelva la red', async () => {
    const s = await setup();
    s.setOnline(false);
    await expect(s.client.generate()).rejects.toThrow(/Sin conexión/);
    expect(s.request).not.toHaveBeenCalled();
    expect(await s.client.read()).toEqual({ kind: 'empty' });
    s.setOnline(true);
    expect(await s.client.generate()).toMatchObject({ kind: 'known' });
    expect(s.request).toHaveBeenCalledTimes(1);
  });
  it('un fallo de red deja el estado incierto pero permite reintentar de inmediato', async () => {
    const s = await setup();
    s.request.mockRejectedValueOnce(new SessionFailure('unavailable'));
    await expect(s.client.generate()).rejects.toThrow(/respuesta del servidor/);
    expect(await s.reopen().read()).toMatchObject({ kind: 'uncertain' });
    expect(await s.reopen().generate()).toMatchObject({ kind: 'known', code: 'A-Bc_opaque' });
    expect(s.request).toHaveBeenCalledTimes(2);
  });
  it('si el reintento recibe 409, explica que ya existe un código vigente sin inventarlo', async () => {
    const s = await setup();
    s.request.mockRejectedValueOnce(new SessionFailure('unavailable', 408));
    await expect(s.client.generate()).rejects.toThrow();
    const first = await s.client.read();
    s.request.mockResolvedValueOnce({ status: 409, body: null } as never);
    const retried = await s.client.generate();
    expect(retried).toMatchObject({ kind: 'uncertain', conflict: true });
    expect(retried).toMatchObject({
      retryAfter: (first as { retryAfter: string }).retryAfter,
    });
    expect(JSON.stringify(retried)).not.toContain('A-Bc_opaque');
  });
  it.each([
    ['sesión vencida', new SessionFailure('expired', 401)],
    ['acceso denegado', new SessionFailure('denied', 403)],
    ['demasiadas solicitudes', new SessionFailure('unavailable', 429)],
  ])('libera la reserva cuando consta que no se creó código (%s)', async (_label, failure) => {
    const s = await setup();
    s.request.mockRejectedValueOnce(failure);
    await expect(s.client.generate()).rejects.toThrow();
    expect(await s.client.read()).toEqual({ kind: 'empty' });
  });
  it('libera la reserva ante una respuesta 422 del servidor', async () => {
    const s = await setup();
    s.request.mockResolvedValueOnce({ status: 422, body: null } as never);
    await expect(s.client.generate()).rejects.toThrow();
    expect(await s.client.read()).toEqual({ kind: 'empty' });
  });
  it('un error 5xx se trata como respuesta perdida: queda incierto y se puede reintentar', async () => {
    const s = await setup();
    s.request.mockRejectedValueOnce(new SessionFailure('unavailable', 503));
    await expect(s.client.generate()).rejects.toThrow();
    expect(await s.client.read()).toMatchObject({ kind: 'uncertain' });
    expect(await s.client.generate()).toMatchObject({ kind: 'known' });
  });
  it('ignores a response arriving after context invalidation', async () => {
    const s = await setup();
    s.request.mockImplementationOnce(async () => {
      s.controller.abort();
      return {
        status: 201,
        body: {
          codigo: 'must-not-persist',
          fecha_expiracion: new Date(start + 86_400_000).toISOString(),
        },
      };
    });
    await expect(s.client.generate()).rejects.toThrow('cuenta cambió');
    const row = await s.db.first<{ value_json: string }>(
      "SELECT value_json FROM qc_storage_control WHERE id LIKE 'rest:link-code:%'",
    );
    expect(row?.value_json).not.toContain('must-not-persist');
  });
});
