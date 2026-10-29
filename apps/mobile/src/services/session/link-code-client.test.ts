import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteTestHarness } from '../../data/local/testing/sqlite-test-harness';
import { migrateDatabase } from '../../data/local/migrations';
import { createLinkCodeClient } from './link-code-client';

const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const owner = '964d32f1-6941-579f-9f08-b60342194da9';
const start = Date.parse('2026-10-27T23:00:00Z');
async function setup() {
  const db = harness.open();
  await migrateDatabase(db);
  let clock = start;
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
    client: createLinkCodeClient(db, session, owner, () => clock),
    setClock: (value: number) => {
      clock = value;
    },
    changeOwner: () => {
      activeOwner = 'other';
    },
    reopen: () => createLinkCodeClient(db, session, owner, () => clock),
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
  it('retains uncertainty after a lost response and a process-style reopen; permits retry only after its barrier', async () => {
    const s = await setup();
    s.request.mockRejectedValueOnce(new Error('response lost after issuance'));
    await expect(s.client.generate()).rejects.toThrow();
    const uncertain = await s.reopen().read();
    expect(uncertain).toMatchObject({ kind: 'uncertain' });
    s.setClock(start + 86_400_000);
    expect(await s.reopen().generate()).toEqual(uncertain);
    expect(s.request).toHaveBeenCalledTimes(1);
    s.setClock(start + 86_460_000);
    expect(await s.client.generate()).toMatchObject({ kind: 'known' });
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
  it('treats a conflict as uncertain instead of regenerating or manufacturing a code', async () => {
    const s = await setup();
    s.request.mockResolvedValueOnce({ status: 409, body: null } as never);
    expect(await s.client.generate()).toMatchObject({ kind: 'uncertain' });
    await s.reopen().generate();
    expect(s.request).toHaveBeenCalledTimes(1);
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
