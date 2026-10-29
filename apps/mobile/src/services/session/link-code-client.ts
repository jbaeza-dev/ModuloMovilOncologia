import type { SqlConnection } from '../../data/local/core/sql';
import type { HttpSessionAdapter } from './http-session-adapter';
import { SessionFailure } from './http-session-types';
import { object } from './response-checks';

const DAY = 86_400_000;
// No GET exists. After an ambiguous POST, also allow for the bounded HTTP exchange.
const UNKNOWN_WINDOW = DAY + 60_000;
export type LinkCodeState =
  | { kind: 'empty' }
  | { kind: 'known'; code: string; expiresAt: string; requestedAt: string }
  | { kind: 'uncertain'; retryAfter: string; requestedAt: string };

/** Stored only in the encrypted database belonging to this owner/environment. */
export function createLinkCodeClient(
  connection: SqlConnection,
  session: Pick<HttpSessionAdapter, 'getCurrentUser' | 'getContextSignal' | 'request'>,
  owner: string,
  now: () => number = Date.now,
) {
  const signal = session.getContextSignal();
  const assert = () => {
    if (signal.aborted || session.getCurrentUser()?.id !== owner)
      throw new SessionFailure('changed');
  };
  const key = 'rest:link-code:' + owner;
  async function read(): Promise<LinkCodeState> {
    assert();
    const row = await connection.first<{ value_json: string }>(
      'SELECT value_json FROM qc_storage_control WHERE id=?',
      [key],
    );
    assert();
    if (!row) return { kind: 'empty' };
    const value: unknown = JSON.parse(row.value_json);
    if (
      !object(value) ||
      typeof value.requestedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.requestedAt))
    )
      throw new SessionFailure('invalid');
    if (
      value.kind === 'known' &&
      typeof value.code === 'string' &&
      value.code.length > 0 &&
      typeof value.expiresAt === 'string' &&
      Number.isFinite(Date.parse(value.expiresAt))
    )
      return value as LinkCodeState;
    if (
      value.kind === 'uncertain' &&
      typeof value.retryAfter === 'string' &&
      Number.isFinite(Date.parse(value.retryAfter))
    )
      return value as LinkCodeState;
    throw new SessionFailure('invalid');
  }
  async function write(value: Exclude<LinkCodeState, { kind: 'empty' }>) {
    assert();
    await connection.run(
      'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
      [key, JSON.stringify(value)],
    );
    assert();
  }
  return {
    read,
    async generate(): Promise<LinkCodeState> {
      // Reserve durably inside a transaction before POST. Also serializes separate clients.
      let existing: LinkCodeState = { kind: 'empty' };
      const requestedAt = new Date(now()).toISOString();
      const reservation: LinkCodeState = {
        kind: 'uncertain',
        requestedAt,
        retryAfter: new Date(now() + UNKNOWN_WINDOW).toISOString(),
      };
      let reserved = false;
      await connection.transaction(async (tx) => {
        assert();
        const row = await tx.first<{ value_json: string }>(
          'SELECT value_json FROM qc_storage_control WHERE id=?',
          [key],
        );
        if (row) {
          existing = JSON.parse(row.value_json) as LinkCodeState;
          const expiry =
            existing.kind === 'known'
              ? existing.expiresAt
              : existing.kind === 'uncertain'
                ? existing.retryAfter
                : null;
          if (!expiry || !Number.isFinite(Date.parse(expiry))) throw new SessionFailure('invalid');
          if (Date.parse(expiry) > now()) return;
        }
        await tx.run(
          'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
          [key, JSON.stringify(reservation)],
        );
        reserved = true;
      });
      assert();
      if (!reserved) return existing;
      // Failure/crash deliberately retains the reservation. Never retry an uncertain POST.
      const response = await session.request(
        'clinical',
        '/api/v1/pacientes/me/codigo-vinculacion',
        'POST',
      );
      assert();
      if (response.status === 409) return reservation;
      if (response.status !== 201 || !object(response.body)) throw new SessionFailure('invalid');
      const { codigo, fecha_expiracion } = response.body;
      if (
        typeof codigo !== 'string' ||
        !codigo ||
        codigo.length > 128 ||
        Array.from(codigo).some((c) => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127) ||
        typeof fecha_expiracion !== 'string' ||
        !Number.isFinite(Date.parse(fecha_expiracion)) ||
        Date.parse(fecha_expiracion) <= now() ||
        Date.parse(fecha_expiracion) > now() + DAY + 60_000
      )
        throw new SessionFailure('invalid');
      const known: LinkCodeState = {
        kind: 'known',
        code: codigo,
        expiresAt: fecha_expiracion,
        requestedAt,
      };
      await write(known);
      return known;
    },
  };
}
