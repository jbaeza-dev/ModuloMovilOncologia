import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agendaStore } from '../src/agenda.js';
import { devices } from '../src/devices.js';
import { AgendaDispatcher } from '../src/dispatcher.js';
import { openDatabase } from '../src/persistence/database.js';
import { migrate } from '../src/persistence/migrations.js';
import type { PushProvider, PushResult, PushReceipt } from '../src/push-provider.js';
import type { GatewayPayloadNotificacion, GatewayCrearRecordatorio } from '@quimiocare/contracts';
import { agendaDate } from '@quimiocare/contracts/agenda';
const url = process.env.GATEWAY_TEST_DATABASE_URL;
if (!url || !/^\/qc_gateway_demo[a-z0-9_]*_test$/.test(new URL(url).pathname))
  throw new Error('Use an isolated gateway test database.');
const db = openDatabase(url),
  second = openDatabase(url),
  owner = randomUUID();
let now = new Date('2026-10-29T11:00:01Z');
class Provider implements PushProvider {
  sent: { token: string; data: GatewayPayloadNotificacion }[] = [];
  result: PushResult = { state: 'accepted', ticket: 'ticket' };
  receiptResult: PushReceipt = { state: 'unknown' };
  during?: () => Promise<void>;
  async send(token: string, data: GatewayPayloadNotificacion) {
    this.sent.push({ token, data });
    await this.during?.();
    return this.result;
  }
  async receipt() {
    return this.receiptResult;
  }
}
let provider: Provider;
const store = () => agendaStore(db, 100, () => now);
const worker = (connection = db) =>
  new AgendaDispatcher(connection, provider, { now: () => now, random: () => 0 });
const rule = (kind: GatewayCrearRecordatorio['tipo'] = 'signos'): GatewayCrearRecordatorio => ({
  id: randomUUID(),
  tipo: kind,
  titulo: 'Prueba sintética',
  zona_horaria: 'America/Santiago',
  horas: ['08:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
});
async function device(user = owner) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO gw_device(id,owner_id,installation_id,push_provider,push_token,platform) VALUES($1,$2,$3,'expo',$4,'android')",
    [id, user, randomUUID(), 'ExpoPushToken[' + randomUUID() + ']'],
  );
  return id;
}
const rows = async () => (await db.query('SELECT * FROM gw_dispatch ORDER BY session_id')).rows;
beforeAll(async () => {
  await migrate(db);
});
beforeEach(async () => {
  await db.query('TRUNCATE gw_device,gw_agenda,gw_completion_event,gw_daily_state CASCADE');
  now = new Date('2026-10-29T11:00:01Z');
  provider = new Provider();
});
afterAll(async () => {
  await db.query('TRUNCATE gw_device,gw_agenda,gw_completion_event,gw_daily_state CASCADE');
  await Promise.all([db.end(), second.end()]);
});
describe('Durable reminder dispatch', () => {
  it('two independent connections reserve/claim once per association and leave receipts unclaimed', async () => {
    const first = await device(),
      other = await device();
    await store().create(owner, rule());
    const result = await Promise.allSettled([worker().tick(), worker(second).tick()]);
    expect(result.every((v) => v.status === 'fulfilled')).toBe(true);
    expect(provider.sent).toHaveLength(2);
    expect(new Set(provider.sent.map((v) => v.data.sesion_id))).toEqual(new Set([first, other]));
    expect((await rows()).map((v) => [v.status, v.attempts, v.receipt_status])).toEqual([
      ['sent', 1, 'pending'],
      ['sent', 1, 'pending'],
    ]);
    expect((await db.query('SELECT count(*)::int AS n FROM gw_receipt')).rows[0].n).toBe(0);
    await worker().tick();
    expect(provider.sent).toHaveLength(2);
  });
  it.each(['pause', 'edit', 'delete', 'complete', 'revoke'] as const)(
    'revalidates %s after reservation',
    async (action) => {
      const session = await device(),
        input = rule();
      await store().create(owner, input);
      await worker().reserve();
      if (action === 'pause' || action === 'edit') {
        const { id, ...config } = input;
        await store().replace(owner, id, {
          ...config,
          activo: action !== 'pause',
          titulo: action === 'edit' ? 'Nuevo horario' : config.titulo,
          version_esperada: 1,
        });
      }
      if (action === 'delete') await store().remove(owner, input.id, 1);
      if (action === 'complete')
        await store().complete(owner, {
          items: [
            {
              operacion_id: randomUUID(),
              tipo_registro: 'signos',
              fecha_local: agendaDate(now.toISOString()),
              zona_horaria: 'America/Santiago',
              registrado_en: now.toISOString(),
            },
          ],
        });
      if (action === 'revoke')
        await devices(db, 'synthetic-key-32-bytes-for-test-only').revoke(owner, session);
      await worker().tick();
      // Editing creates a distinct civil occurrence with the new version; only the old one is cancelled.
      expect(provider.sent).toHaveLength(action === 'edit' ? 1 : 0);
      if (action === 'edit') expect(provider.sent[0]!.data.version_recordatorio).toBe(2);
      const old = (await rows()).find((v) => v.reminder_version === 1);
      expect(old!.status).toBe('cancelled');
    },
  );
  it('completion suppresses signos but never medication, and foreign account/device is not selected', async () => {
    await device();
    await device(randomUUID());
    await store().create(owner, rule());
    await store().create(owner, rule('medicacion'));
    await store().complete(owner, {
      items: [
        {
          operacion_id: randomUUID(),
          tipo_registro: 'signos',
          fecha_local: '2026-10-29',
          zona_horaria: 'America/Santiago',
          registrado_en: now.toISOString(),
        },
      ],
    });
    await worker().tick();
    expect(provider.sent).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });
  it('does not resurrect an in-flight send cancelled by a completed save', async () => {
    await device();
    await store().create(owner, rule());
    provider.during = async () => {
      await store().complete(owner, {
        items: [
          {
            operacion_id: randomUUID(),
            tipo_registro: 'signos',
            fecha_local: '2026-10-29',
            zona_horaria: 'America/Santiago',
            registrado_en: now.toISOString(),
          },
        ],
      });
    };
    await worker().tick();
    expect((await rows())[0].status).toBe('cancelled');
    expect((await db.query('SELECT state FROM gw_dispatch_attempt')).rows[0].state).toBe(
      'accepted',
    );
  });
  it('bounds uncertain retries to three, with backoff and permanent audit', async () => {
    await device();
    await store().create(owner, rule());
    provider.result = { state: 'uncertain', code: 'ProviderTransportUncertain' };
    await worker().tick();
    expect(provider.sent).toHaveLength(1);
    await worker().tick();
    expect(provider.sent).toHaveLength(1);
    now = new Date(now.getTime() + 6000);
    await worker().tick();
    now = new Date(now.getTime() + 11000);
    await worker().tick();
    now = new Date(now.getTime() + 60000);
    await worker().tick();
    expect(provider.sent).toHaveLength(3);
    expect((await rows())[0].status).toBe('failed');
    expect(
      (await db.query('SELECT state FROM gw_dispatch_attempt')).rows.map((v) => v.state),
    ).toEqual(['uncertain', 'uncertain', 'uncertain']);
  });
  it('recovers an abandoned sending lease and preserves its uncertain attempt', async () => {
    const session = await device();
    await store().create(owner, rule());
    await worker().reserve();
    const row = (await rows())[0],
      lease = randomUUID();
    await db.query(
      "UPDATE gw_dispatch SET status='sending',attempts=1,lease_id=$1,lease_until=$2",
      [lease, new Date(now.getTime() - 1)],
    );
    await db.query(
      "INSERT INTO gw_dispatch_attempt(id,occurrence_id,session_id,ordinal,device_version,state,started_at) VALUES($1,$2,$3,1,1,'started',$4)",
      [lease, row.occurrence_id, session, new Date(now.getTime() - 20000)],
    );
    await worker().tick();
    expect((await rows())[0].attempts).toBe(2);
    expect(
      (await db.query('SELECT state FROM gw_dispatch_attempt WHERE id=$1', [lease])).rows[0].state,
    ).toBe('uncertain');
  });
  it('expires due reservations rather than replaying late work', async () => {
    await device();
    await store().create(owner, rule());
    await worker().reserve();
    now = new Date('2026-10-29T11:10:01Z');
    await worker().tick();
    expect(provider.sent).toHaveLength(0);
    expect((await rows())[0].status).toBe('expired');
  });
  it('disables DeviceNotRegistered but preserves a token rotated while sending', async () => {
    const session = await device();
    await store().create(owner, rule());
    provider.result = { state: 'permanent', code: 'DeviceNotRegistered' };
    await worker().tick();
    expect(
      (await db.query('SELECT token_enabled FROM gw_device WHERE id=$1', [session])).rows[0]
        .token_enabled,
    ).toBe(false);
    await db.query('TRUNCATE gw_dispatch CASCADE');
    await db.query('UPDATE gw_device SET token_enabled=true,version=2 WHERE id=$1', [session]);
    provider.during = async () => {
      await db.query(
        "UPDATE gw_device SET push_token='ExpoPushToken[rotated]',version=3 WHERE id=$1",
        [session],
      );
    };
    await worker().tick();
    expect(
      (await db.query('SELECT token_enabled FROM gw_device WHERE id=$1', [session])).rows[0]
        .token_enabled,
    ).toBe(true);
  });
  it('checks delayed provider receipts without recording application processing', async () => {
    const session = await device();
    await store().create(owner, rule());
    await worker().tick();
    now = new Date(now.getTime() + 901000);
    provider.receiptResult = { state: 'error', code: 'DeviceNotRegistered' };
    expect(await worker().receipts()).toBe(1);
    expect(
      (await db.query('SELECT token_enabled FROM gw_device WHERE id=$1', [session])).rows[0]
        .token_enabled,
    ).toBe(false);
    expect((await db.query('SELECT count(*)::int AS n FROM gw_receipt')).rows[0].n).toBe(0);
  });
  it('two actual Node processes use the same lease without duplicate provider calls', async () => {
    await device();
    await store().create(owner, rule());
    const script = `import {openDatabase} from './dist/persistence/database.js';import {AgendaDispatcher} from './dist/dispatcher.js';const db=openDatabase(process.env.GATEWAY_TEST_DATABASE_URL);try{const p={send:async(t,d)=>{console.log(JSON.stringify({event:'provider',occurrence:d.ocurrencia_id,session:d.sesion_id}));await new Promise(r=>setTimeout(r,75));return {state:'accepted',ticket:'process-ticket'}},receipt:async()=>({state:'unknown'})};await new AgendaDispatcher(db,p,{now:()=>new Date('2026-10-29T11:00:01Z')}).tick()}finally{await db.end()}`;
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          env: process.env,
          windowsHide: true,
        });
        let output = '',
          error = '';
        child.stdout.on('data', (v) => (output += v));
        child.stderr.on('data', (v) => (error += v));
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? resolve(output) : reject(new Error('Child worker failed: ' + error)),
        );
      });
    const output = await Promise.all([run(), run()]);
    expect(output.join('').split('\n').filter(Boolean)).toHaveLength(1);
    expect((await rows())[0].attempts).toBe(1);
  });
});
