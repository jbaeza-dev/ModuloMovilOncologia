import type { SqlConnection } from '../../data/local/core/sql';
import type { HttpSessionAdapter } from './http-session-adapter';
import { SessionFailure } from './http-session-types';
import { object } from './response-checks';

const DAY = 86_400_000;
// No GET exists. After an ambiguous POST, a code created by the server expires within this window.
const UNKNOWN_WINDOW = DAY + 60_000;
export type LinkCodeState =
  | { kind: 'empty' }
  | { kind: 'known'; code: string; expiresAt: string; requestedAt: string }
  | {
      kind: 'uncertain';
      retryAfter: string;
      requestedAt: string;
      /** El servidor respondió 409: ya existe un código vigente que no llegó a este teléfono. */
      conflict?: boolean;
    };

/** Una sola solicitud a la vez por cuenta dentro de la app, aunque haya varios clientes. */
const inFlight = new Map<string, Promise<LinkCodeState>>();

/**
 * Stored only in the encrypted database belonging to this owner/environment.
 *
 * C-05 returns 409 while a pending code is still valid, so a retry can never create a second
 * code. An uncertain state (lost response) can therefore always be retried by the patient.
 */
export function createLinkCodeClient(
  connection: SqlConnection,
  session: Pick<HttpSessionAdapter, 'getCurrentUser' | 'getContextSignal' | 'request'>,
  owner: string,
  now: () => number = Date.now,
  isOnline: () => Promise<boolean> = async () => true,
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
  /** Vuelve al estado anterior a la solicitud: consta que el servidor no creó ningún código. */
  async function release(previous: string | null) {
    assert();
    if (previous === null) await connection.run('DELETE FROM qc_storage_control WHERE id=?', [key]);
    else
      await connection.run('UPDATE qc_storage_control SET value_json=? WHERE id=?', [
        previous,
        key,
      ]);
  }
  /** Sin respuesta del servidor no consta que no se creó: queda incierto y se puede reintentar. */
  function unanswered(failure: unknown): boolean {
    if (!(failure instanceof SessionFailure)) return true;
    if (failure.kind === 'expired' || failure.kind === 'denied') return false;
    if (failure.kind === 'unavailable')
      // status 0: no hubo respuesta HTTP (red caída o corte en medio).
      return failure.status === 0 || failure.status === 408 || failure.status >= 500;
    return true;
  }
  async function request(): Promise<LinkCodeState> {
    assert();
    if (!(await isOnline()))
      throw new Error(
        'Sin conexión: no se solicitó ningún código. Inténtalo cuando tengas internet.',
      );
    assert();
    let existing: LinkCodeState = { kind: 'empty' };
    let previous: string | null = null;
    let reservation: Extract<LinkCodeState, { kind: 'uncertain' }> | null = null;
    // Reserve durably inside a transaction before POST, so a crash keeps the uncertainty.
    await connection.transaction(async (tx) => {
      assert();
      const row = await tx.first<{ value_json: string }>(
        'SELECT value_json FROM qc_storage_control WHERE id=?',
        [key],
      );
      if (row) {
        previous = row.value_json;
        existing = JSON.parse(row.value_json) as LinkCodeState;
        if (existing.kind === 'known') {
          if (!Number.isFinite(Date.parse(existing.expiresAt))) throw new SessionFailure('invalid');
          if (Date.parse(existing.expiresAt) > now()) return;
        }
      }
      const requestedAt = new Date(now()).toISOString();
      // A retry keeps the original window: a code created by the lost request expires within it.
      reservation = {
        kind: 'uncertain',
        requestedAt,
        retryAfter:
          existing.kind === 'uncertain' && Date.parse(existing.retryAfter) > now()
            ? existing.retryAfter
            : new Date(now() + UNKNOWN_WINDOW).toISOString(),
      };
      await tx.run(
        'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
        [key, JSON.stringify(reservation)],
      );
    });
    assert();
    if (!reservation) return existing;
    const pending: Extract<LinkCodeState, { kind: 'uncertain' }> = reservation;
    let response: { status: number; body: unknown };
    try {
      response = await session.request(
        'clinical',
        '/api/v1/pacientes/me/codigo-vinculacion',
        'POST',
      );
    } catch (failure) {
      assert();
      if (!unanswered(failure)) {
        await release(previous);
        throw failure;
      }
      throw new Error(
        'No llegó la respuesta del servidor. Puedes intentar de nuevo: no se creará un código duplicado.',
        { cause: failure },
      );
    }
    assert();
    if (response.status === 409) {
      const conflict = { ...pending, conflict: true as const };
      await write(conflict);
      return conflict;
    }
    if (response.status >= 400 && response.status < 500) {
      await release(previous);
      throw new SessionFailure('invalid', response.status);
    }
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
      requestedAt: pending.requestedAt,
    };
    await write(known);
    return known;
  }
  return {
    read,
    generate(): Promise<LinkCodeState> {
      const current = inFlight.get(key);
      if (current) return current;
      const job = request().finally(() => {
        if (inFlight.get(key) === job) inFlight.delete(key);
      });
      inFlight.set(key, job);
      return job;
    },
  };
}
