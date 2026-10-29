import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayAgenda, GatewayRecordatorio } from '@quimiocare/contracts';
import { AGENDA_POLICY, normalizedReminder } from '@quimiocare/contracts/agenda';
import { createSqliteTestHarness } from '../local/testing/sqlite-test-harness';
import { migrateDatabase } from '../local/migrations';
import { agendaRepository } from './agenda-repository';
import { enqueueOperational } from './operational-outbox';
import { AgendaClient } from '../../services/agenda/agenda-client';
import type { HttpSessionAdapter } from '../../services/session/http-session-adapter';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const scope = { owner: '964d32f1-6941-579f-9f08-b60342194da9', environment: 'demo:agenda' },
  id = 'ed21a163-0102-4b25-98af-4b3552cc87ad',
  at = '2026-10-29T11:00:00Z';
const rule: GatewayRecordatorio = {
  id,
  tipo: 'signos',
  titulo: 'Registro',
  zona_horaria: 'America/Santiago',
  horas: ['08:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
  version: 1,
  creado_en: at,
  actualizado_en: at,
  canal: 'push_con_respaldo_local',
  respaldo_segundos: 120,
};
const snapshot = (version = 1, start = '2026-10-29', end = start): GatewayAgenda => ({
  version_agenda: version,
  hora_servidor: at,
  desde: start,
  hasta: end,
  recordatorios: [rule],
  cumplimientos: [],
  politica: AGENDA_POLICY,
});
async function setup() {
  const db = harness.open();
  await migrateDatabase(db);
  return { db, repo: agendaRepository(db, scope, () => undefined) };
}
describe('Agenda compartida local', () => {
  it('descarta versiones antiguas y conserva cumplimientos fuera del intervalo recibido', async () => {
    const { repo } = await setup();
    await repo.snapshot({
      ...snapshot(2, '2026-10-28'),
      cumplimientos: [
        {
          tipo_registro: 'signos',
          fecha_local: '2026-10-28',
          zona_horaria: 'America/Santiago',
          cumplido: true,
        },
      ],
    });
    await repo.snapshot(snapshot(3));
    expect(await repo.snapshot({ ...snapshot(1), recordatorios: [] })).toBe(false);
    expect((await repo.read()).rules).toEqual([rule]);
    expect((await repo.read()).completed.has('signos:2026-10-28')).toBe(true);
  });
  it('superpone un SAVE local sin ACK y nunca lo aplica a otra cuenta/entorno', async () => {
    const { db, repo } = await setup();
    await db.transaction((tx) =>
      enqueueOperational(
        tx,
        scope,
        'completion',
        {
          operacion_id: id,
          tipo_registro: 'epro',
          fecha_local: '2026-10-29',
          zona_horaria: 'America/Santiago',
          registrado_en: at,
        },
        at,
      ),
    );
    await repo.snapshot(snapshot());
    expect((await repo.read()).completed.has('epro:2026-10-29')).toBe(true);
    await db.run("UPDATE qc_gateway_outbox SET status='conflict' WHERE id=?", [id]);
    expect((await repo.read()).completed.has('epro:2026-10-29')).toBe(true);
    expect(
      (await agendaRepository(db, { ...scope, environment: 'other' }, () => undefined).read())
        .completed.size,
    ).toBe(0);
  });
  it('conserva una intención sin presentarla como regla confirmada', async () => {
    const { repo } = await setup();
    await repo.intent(id, 'create', { id, ...normalizedReminder(rule) });
    expect((await repo.read()).rules).toEqual([]);
    expect(await repo.intents()).toHaveLength(1);
    await expect(repo.intent(id, 'create', { id })).rejects.toThrow('intención anterior');
  });
  it('rechaza un resultado que llega después de cerrar el contexto', async () => {
    const { db } = await setup();
    let active = true;
    const repo = agendaRepository(db, scope, () => {
      if (!active) throw new Error('changed');
    });
    active = false;
    await expect(repo.snapshot(snapshot())).rejects.toThrow('changed');
    expect(await db.first('SELECT * FROM qc_agenda_state')).toBeNull();
  });
});
describe('Cliente HTTP de agenda', () => {
  async function client() {
    const { db } = await setup(),
      abort = new AbortController(),
      request = vi.fn();
    const session = {
      getCurrentUser: () => ({ id: scope.owner }),
      getContextSignal: () => abort.signal,
      request,
    } as unknown as HttpSessionAdapter;
    return { client: new AgendaClient(session, db, scope.environment), request, abort };
  }
  it('confirma POST solo al obtener ACK y utiliza las rutas contractuales', async () => {
    const { client: c, request } = await client();
    request
      .mockResolvedValueOnce({
        status: 201,
        body: { recordatorio: rule, version_agenda: 2, hora_servidor: at },
      })
      .mockResolvedValueOnce({ status: 200, body: snapshot(2) });
    await c.save(id, normalizedReminder(rule));
    expect(request.mock.calls[0]!.slice(0, 4)).toEqual([
      'gateway',
      '/api/gateway/recordatorios',
      'POST',
      { id, ...normalizedReminder(rule) },
    ]);
    expect((await c.read()).rules).toEqual([rule]);
    expect(await c.repository.intents()).toEqual([]);
  });
  it('recupera un ACK PUT perdido con GET sin repetir la escritura', async () => {
    const { client: c, request } = await client();
    request.mockRejectedValueOnce(new Error('lost ACK')).mockResolvedValueOnce({
      status: 200,
      body: { recordatorio: { ...rule, version: 2 }, version_agenda: 3, hora_servidor: at },
    });
    await c.save(id, normalizedReminder(rule), 1);
    expect(request.mock.calls.map((v) => v[2])).toEqual(['PUT', 'GET']);
    expect((await c.read()).rules[0]!.version).toBe(2);
    expect(await c.repository.intents()).toEqual([]);
  });
  it('marca conflicto si GET muestra una edición diferente y conserva la intención', async () => {
    const { client: c, request } = await client();
    request.mockRejectedValueOnce(new Error('lost ACK')).mockResolvedValueOnce({
      status: 200,
      body: {
        recordatorio: { ...rule, titulo: 'Otro editor', version: 2 },
        version_agenda: 3,
        hora_servidor: at,
      },
    });
    await expect(c.save(id, normalizedReminder(rule), 1)).rejects.toMatchObject({
      kind: 'conflict',
    });
    expect((await c.repository.intents())[0]!.state).toBe('conflict');
    expect((await c.read()).rules).toEqual([]);
  });
  it('DELETE envía versión en query y ningún cuerpo JSON', async () => {
    const { client: c, request } = await client();
    request
      .mockResolvedValueOnce({ status: 204, body: null })
      .mockResolvedValueOnce({ status: 200, body: { ...snapshot(2), recordatorios: [] } });
    await c.remove(id, 1);
    expect(request.mock.calls[0]!.slice(0, 4)).toEqual([
      'gateway',
      '/api/gateway/recordatorios/' + id + '?version_esperada=1',
      'DELETE',
      undefined,
    ]);
  });
  it('descarta una respuesta tardía de la identidad anterior', async () => {
    const { client: c, request, abort } = await client();
    request.mockImplementationOnce(async () => {
      abort.abort();
      return { status: 200, body: snapshot() };
    });
    await expect(c.refresh()).rejects.toMatchObject({ kind: 'changed' });
  });
});
