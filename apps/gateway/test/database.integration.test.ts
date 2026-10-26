import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openDatabase, transaction } from '../src/persistence/database.js';
import { databaseReady, migrate, MIGRATIONS } from '../src/persistence/migrations.js';
import { seedDemo } from '../src/seed.js';
import { startGateway } from '../src/runtime.js';
import { testConfig } from './fixtures.js';
const url = process.env.GATEWAY_TEST_DATABASE_URL;
if (!url || !/^\/qc_gateway_demo[a-z0-9_]*_test$/.test(new URL(url).pathname))
  throw new Error(
    'GATEWAY_TEST_DATABASE_URL debe usar una base qc_gateway_demo*_test aislada; la suite elimina solo sus tablas gateway.',
  );
const db = openDatabase(url),
  second = openDatabase(url);
const owner = randomUUID(),
  otherOwner = randomUUID();
async function eraseGatewayTestTables() {
  await db.query(
    'DROP TABLE IF EXISTS gw_receipt, gw_dispatch, gw_daily_state, gw_completion_event, gw_reminder, gw_agenda, gw_device, gw_schema_migration CASCADE',
  );
  await db.query('DROP FUNCTION IF EXISTS gw_push_digest(text)');
}
async function device(
  connection = db,
  installation: string = randomUUID(),
  token: string = randomUUID(),
  user: string = owner,
  id: string = randomUUID(),
) {
  await connection.query(
    "INSERT INTO gw_device(id,owner_id,installation_id,push_provider,push_token,platform) VALUES($1,$2,$3,'expo',$4,'android')",
    [id, user, installation, token],
  );
  return id;
}
async function reminder(user = owner) {
  await db.query('INSERT INTO gw_agenda(owner_id) VALUES($1) ON CONFLICT DO NOTHING', [user]);
  const id = randomUUID();
  await db.query(
    "INSERT INTO gw_reminder(id,owner_id,kind,title,timezone,hours,weekdays,starts_on,active,create_hash) VALUES($1,$2,'epro','Registro diario','America/Santiago',ARRAY['08:00'::time],ARRAY[1,2,3,4,5,6,7]::smallint[],current_date,true,$3)",
    [id, user, 'a'.repeat(64)],
  );
  return id;
}
beforeAll(async () => {
  await db.query('SELECT 1');
});
beforeEach(async () => {
  await eraseGatewayTestTables();
  await migrate(db);
});
afterAll(async () => {
  await eraseGatewayTestTables();
  await Promise.all([db.end(), second.end()]);
});
describe('PostgreSQL migrations and operational invariants', () => {
  it('migrates empty, upgrades v1 and repeats safely with checksums', async () => {
    await eraseGatewayTestTables();
    await migrate(db, 1);
    const session = await device();
    await migrate(db);
    await migrate(second);
    await databaseReady(db);
    expect((await db.query('SELECT id FROM gw_device')).rows).toEqual([{ id: session }]);
    expect(
      (await db.query('SELECT version FROM gw_schema_migration ORDER BY version')).rows,
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });
  it('serializes concurrent migrations on distinct connections', async () => {
    await eraseGatewayTestTables();
    await Promise.all([migrate(db), migrate(second)]);
    await databaseReady(second);
    expect(
      (await db.query('SELECT count(*)::integer AS n FROM gw_schema_migration')).rows[0]?.n,
    ).toBe(2);
  });
  it('rejects incompatible/tampered migration history', async () => {
    await db.query('UPDATE gw_schema_migration SET checksum=$1 WHERE version=1', ['b'.repeat(64)]);
    await expect(migrate(db)).rejects.toThrow('cambió');
    await expect(databaseReady(db)).rejects.toThrow('incompatible');
  });
  it('keeps seed separate and idempotent with no devices or clinical data', async () => {
    expect((await db.query('SELECT count(*)::integer AS n FROM gw_agenda')).rows[0]?.n).toBe(0);
    await seedDemo(db);
    await seedDemo(db);
    expect((await db.query('SELECT count(*)::integer AS n FROM gw_agenda')).rows[0]?.n).toBe(2);
    expect((await db.query('SELECT count(*)::integer AS n FROM gw_device')).rows[0]?.n).toBe(0);
  });
  it.each(['installation', 'token'])(
    'prevents concurrent active %s collisions at the database',
    async (kind) => {
      const shared = randomUUID();
      const results = await Promise.allSettled([
        device(
          db,
          kind === 'installation' ? shared : randomUUID(),
          kind === 'token' ? shared : randomUUID(),
        ),
        device(
          second,
          kind === 'installation' ? shared : randomUUID(),
          kind === 'token' ? shared : randomUUID(),
          otherOwner,
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected');
      expect(failed?.status === 'rejected' ? (failed.reason as { code: string }).code : null).toBe(
        '23505',
      );
    },
  );
  it('accepts and deduplicates the maximum contract token size', async () => {
    const token = 'a'.repeat(4096);
    const id = await device(db, randomUUID(), token);
    await expect(device(second, randomUUID(), token)).rejects.toMatchObject({ code: '23505' });
    await db.query('UPDATE gw_device SET active=false,revoked_at=now() WHERE id=$1', [id]);
    await expect(device(second, randomUUID(), token, otherOwner)).resolves.toBeTypeOf('string');
  });
  it('rolls back all writes when a transaction fails', async () => {
    const id = randomUUID();
    await expect(
      transaction(db, async (client) => {
        await client.query('INSERT INTO gw_agenda(owner_id) VALUES($1)', [id]);
        throw new Error('synthetic interruption');
      }),
    ).rejects.toThrow('synthetic interruption');
    expect((await db.query('SELECT * FROM gw_agenda WHERE owner_id=$1', [id])).rows).toHaveLength(
      0,
    );
  });
  it('rolls back an interrupted connection and recovers with a fresh connection', async () => {
    const client = await second.connect();
    client.on('error', () => {});
    const id = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO gw_agenda(owner_id) VALUES($1)', [id]);
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await db.query('SELECT pg_terminate_backend($1)', [pid]);
      await expect(client.query('COMMIT')).rejects.toThrow();
    } finally {
      client.release(true);
    }
    expect((await db.query('SELECT * FROM gw_agenda WHERE owner_id=$1', [id])).rows).toHaveLength(
      0,
    );
    expect((await second.query('SELECT 1 AS ready')).rows[0]?.ready).toBe(1);
  });
  it('reserves one dispatch per occurrence and association under concurrency', async () => {
    const session = await device(),
      record = await reminder();
    const occurrence = `${record}:1:2026-10-26:0800`;
    const sql =
      "INSERT INTO gw_dispatch(occurrence_id,session_id,owner_id,reminder_id,reminder_version,scheduled_at,backup_at,expires_at) VALUES($1,$2,$3,$4,1,now(),now()+interval '120 seconds',now()+interval '600 seconds') ON CONFLICT DO NOTHING RETURNING occurrence_id";
    const rows = await Promise.all([
      db.query(sql, [occurrence, session, owner, record]),
      second.query(sql, [occurrence, session, owner, record]),
    ]);
    expect(rows.reduce((sum, row) => sum + row.rows.length, 0)).toBe(1);
    const session2 = await device();
    expect((await db.query(sql, [occurrence, session2, owner, record])).rowCount).toBe(1);
  });
  it('rejects dispatch across owners and retains a reminder tombstone', async () => {
    const session = await device(),
      record = await reminder(otherOwner);
    await expect(
      db.query(
        "INSERT INTO gw_dispatch(occurrence_id,session_id,owner_id,reminder_id,reminder_version,scheduled_at,backup_at,expires_at) VALUES('cross-owner',$1,$2,$3,1,now(),now(),now())",
        [session, owner, record],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await db.query('UPDATE gw_reminder SET deleted_at=now(),active=false WHERE id=$1', [record]);
    expect(
      (
        await db.query('SELECT id FROM gw_reminder WHERE id=$1 AND deleted_at IS NOT NULL', [
          record,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it('enforces a globally stable event UUID across concurrent writers', async () => {
    const id = randomUUID();
    const sql =
      "INSERT INTO gw_completion_event(operation_id,owner_id,kind,local_date,timezone,registered_at,request_hash) VALUES($1,$2,'epro',current_date,'America/Santiago',now(),$3)";
    const results = await Promise.allSettled([
      db.query(sql, [id, owner, 'a'.repeat(64)]),
      second.query(sql, [id, owner, 'a'.repeat(64)]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('starts twice without duplicating data and closes HTTP/pool gracefully', async () => {
    const id = await device();
    const config = { ...testConfig({ GATEWAY_DATABASE_URL: url }), port: 0 };
    for (let index = 0; index < 2; index++) {
      const runtime = await startGateway(config, () => {});
      const addr = runtime.server.address();
      if (!addr || typeof addr === 'string') throw new Error('No port');
      const base = `http://127.0.0.1:${addr.port}`;
      expect((await fetch(base + '/health')).status).toBe(200);
      expect((await fetch(base + '/internal/ready')).status).toBe(200);
      await Promise.all([runtime.stop(), runtime.stop()]);
      expect(runtime.server.listening).toBe(false);
    }
    expect((await db.query('SELECT id FROM gw_device')).rows).toEqual([{ id }]);
  });
  it('contains only the planned operational schema and no clinical/chat payload columns', async () => {
    const rows = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'gw_%'",
    );
    expect(rows.rows.map((r) => r.column_name).join(',')).not.toMatch(
      /temperatura|presion|epro_respuesta|mensaje|conversacion|expediente|refresh_token|access_token/,
    );
    for (const file of MIGRATIONS)
      expect(
        await readFile(new URL(`../src/persistence/migrations/${file}`, import.meta.url), 'utf8'),
      ).not.toMatch(/CREATE TABLE.*(?:clinica|signo|paciente|chat)/i);
  });
});
