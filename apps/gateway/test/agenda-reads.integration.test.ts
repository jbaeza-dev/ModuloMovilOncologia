import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { GatewayCrearRecordatorio } from '@quimiocare/contracts';
import { openDatabase } from '../src/persistence/database.js';
import { migrate } from '../src/persistence/migrations.js';
import { agendaStore } from '../src/agenda.js';

const url = process.env.GATEWAY_TEST_DATABASE_URL;
if (!url || !/^\/qc_gateway_demo[a-z0-9_]*_test$/.test(new URL(url).pathname))
  throw new Error('Use an isolated gateway test database.');
const db = openDatabase(url),
  blocker = openDatabase(url);
const store = agendaStore(db);
const configuration = (): GatewayCrearRecordatorio => ({
  id: randomUUID(),
  tipo: 'signos',
  titulo: 'Horario de prueba',
  zona_horaria: 'America/Santiago',
  horas: ['08:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
});

/** Mantiene bloqueada la agenda del paciente, como lo haría una edición en curso. */
async function withAgendaLocked<T>(owner: string, action: () => Promise<T>): Promise<T> {
  const client = await blocker.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT owner_id FROM gw_agenda WHERE owner_id=$1 FOR UPDATE', [owner]);
    return await action();
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
/** Falla en vez de quedar esperando si una lectura intenta tomar un bloqueo. */
function withinLockTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('La lectura quedó esperando el bloqueo.')), 2000),
    ),
  ]);
}

beforeAll(async () => {
  await migrate(db);
});
afterAll(async () => {
  await Promise.all([db.end(), blocker.end()]);
});

describe('lecturas de la agenda', () => {
  it('leer la agenda de un paciente nuevo no escribe en la base y responde la versión 1', async () => {
    const owner = randomUUID();
    const agenda = await store.list(owner);
    expect(agenda.version_agenda).toBe(1);
    expect(agenda.recordatorios).toEqual([]);
    const rows = await db.query('SELECT 1 FROM gw_agenda WHERE owner_id=$1', [owner]);
    expect(rows.rowCount).toBe(0);
  });

  it('listar y consultar un recordatorio no esperan a una edición en curso', async () => {
    const owner = randomUUID();
    const created = await store.create(owner, configuration());
    const id = created.body.recordatorio.id;
    await withAgendaLocked(owner, async () => {
      const agenda = await withinLockTimeout(store.list(owner));
      expect(agenda.recordatorios.map((rule) => rule.id)).toEqual([id]);
      expect(agenda.version_agenda).toBe(2);
      const one = await withinLockTimeout(store.get(owner, id));
      expect(one.recordatorio.id).toBe(id);
      expect(one.version_agenda).toBe(2);
    });
  });

  it('la versión y los recordatorios salen de la misma foto de la base', async () => {
    const owner = randomUUID();
    await store.create(owner, configuration());
    // Se repite muchas veces para que una lectura caiga entre dos escrituras.
    const writes = Array.from({ length: 10 }, () => store.create(owner, configuration()));
    const reads = Array.from({ length: 30 }, () => store.list(owner));
    const [, snapshots] = await Promise.all([Promise.all(writes), Promise.all(reads)]);
    for (const snapshot of snapshots)
      expect(snapshot.recordatorios.length).toBe(snapshot.version_agenda - 1);
  });

  it('los recibos de Expo buscan el envío por su ticket con un índice', async () => {
    const indexes = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename='gw_dispatch' AND indexdef LIKE '%(provider_ticket)%'",
    );
    expect(indexes.rowCount).toBe(1);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan=off');
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        "EXPLAIN UPDATE gw_dispatch SET receipt_status='ok' WHERE provider_ticket='ticket-sintetico'",
      );
      expect(plan.rows.map((row) => row['QUERY PLAN']).join('\n')).toMatch(
        /Index Scan using gw_dispatch_provider_ticket/,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
