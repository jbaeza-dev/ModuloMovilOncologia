import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import {
  validateResponse,
  type GatewayCrearRecordatorio,
  type GatewayRecordatorioEnvelope,
} from '@quimiocare/contracts';
import { agendaDate, agendaInstant, reminderOccurrence } from '@quimiocare/contracts/agenda';
import { openDatabase } from '../src/persistence/database.js';
import { migrate } from '../src/persistence/migrations.js';
import { createApp } from '../src/http/app.js';
import { agendaStore } from '../src/agenda.js';
import { testConfig } from './fixtures.js';
const url = process.env.GATEWAY_TEST_DATABASE_URL;
if (!url || !/^\/qc_gateway_demo[a-z0-9_]*_test$/.test(new URL(url).pathname))
  throw new Error('Use an isolated gateway test database.');
const db = openDatabase(url),
  second = openDatabase(url),
  owner = randomUUID(),
  other = randomUUID();
const stores = [agendaStore(db), agendaStore(second)];
const medicationOwner = randomUUID(),
  medicationOther = randomUUID();
let medicationActive = true;
const logs: string[] = [],
  tokens: Record<string, string> = {};
let clinical: Server,
  ai: Server,
  gateway: Server,
  base: string,
  aiMode = 'respuesta',
  aiCalls = 0;
let aiBody: unknown, aiPath: string | undefined;
const configuration = (): GatewayCrearRecordatorio => ({
  id: randomUUID(),
  tipo: 'signos',
  titulo: 'Horario de prueba',
  zona_horaria: 'America/Santiago',
  horas: ['15:00', '08:00'],
  dias_semana: [7, 6, 5, 4, 3, 2, 1],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
});
async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error();
  return `http://127.0.0.1:${a.port}`;
}
async function request(path: string, method = 'GET', body?: unknown, account = owner) {
  const response = await fetch(base + '/api/gateway' + path, {
    method,
    headers: {
      authorization: 'Bearer ' + tokens[account],
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const event = (id = randomUUID(), kind: 'epro' | 'signos' = 'signos') => {
  const at = new Date(Date.now() - 2 * 86400000).toISOString();
  return {
    operacion_id: id,
    tipo_registro: kind,
    fecha_local: agendaDate(at),
    zona_horaria: 'America/Santiago' as const,
    registrado_en: at,
  };
};
beforeAll(async () => {
  await migrate(db);
  clinical = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v1/pacientes/me/perfil-clinico') {
      res.end(
        JSON.stringify({
          id: randomUUID(),
          fecha_actualizacion: new Date().toISOString(),
          medicamentos: [
            {
              id:
                req.headers.authorization === 'Bearer ' + tokens[owner]
                  ? medicationOwner
                  : medicationOther,
              medicamento_id: randomUUID(),
              nombre: 'Dato sintético',
              activo: medicationActive,
              fecha_inicio: '2020-01-01',
              fecha_termino: null,
            },
          ],
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        id: req.headers.authorization === 'Bearer ' + tokens[owner] ? owner : other,
        email: 'synthetic@example.com',
        rol: 'paciente',
        activo: true,
        estado_incorporacion: 'COMPLETO',
      }),
    );
  });
  ai = createServer(async (req, res) => {
    aiCalls++;
    aiPath = req.url;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c as Buffer));
    aiBody = JSON.parse(Buffer.concat(chunks).toString());
    if (aiMode === 'timeout') {
      setTimeout(() => {
        if (!res.destroyed) res.end('{}');
      }, 350).unref();
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (aiMode === 'invalid') {
      res.end('{invalid');
      return;
    }
    if (aiMode === 'error') {
      res.statusCode = 503;
      res.end(JSON.stringify({ detail: 'Servicio sintético no disponible.' }));
      return;
    }
    res.end(
      JSON.stringify({
        respuesta: aiMode === 'no_disponible' ? 'Servicio no disponible.' : 'Respuesta sintética',
        fuentes: [{ tema_id: 'sintetico', guia: 1, tema: 'Material de prueba' }],
        requiere_urgencia: aiMode === 'urgente',
        confianza_nivel: 'baja',
        estado_respuesta: aiMode === 'urgente' ? 'respuesta' : aiMode,
        debug: null,
      }),
    );
  });
  const config = testConfig({
    GATEWAY_DATABASE_URL: url,
    CLINICAL_API_URL: await listen(clinical),
    AI_API_URL: await listen(ai),
    AI_TIMEOUT_MS: '100',
  });
  for (const id of [owner, other])
    tokens[id] = await new SignJWT({ cohort: 'quimiocare-demo' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(id)
      .setIssuer(config.authIssuer)
      .setAudience(config.authAudience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.authVerifyKey));
  gateway = createServer(createApp(config, db, (line) => logs.push(JSON.stringify(line))));
  base = await listen(gateway);
});
beforeEach(async () => {
  aiMode = 'respuesta';
  medicationActive = true;
  aiCalls = 0;
  aiBody = undefined;
  await db.query(
    'TRUNCATE gw_receipt,gw_dispatch,gw_daily_state,gw_completion_event,gw_reminder_revision,gw_reminder,gw_agenda,gw_device CASCADE',
  );
});
afterAll(async () => {
  for (const server of [gateway, clinical, ai])
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  await Promise.all([db.end(), second.end()]);
});

describe('Agenda HTTP y PostgreSQL con dos conexiones independientes', () => {
  it('devuelve snapshot vacío versionado y permite replay normalizado de alta', async () => {
    const empty = await request('/recordatorios');
    expect(empty.status).toBe(200);
    expect(validateResponse('G-07', 200, empty.body).valid).toBe(true);
    expect(empty.body.recordatorios).toEqual([]);
    const input = configuration(),
      created = await request('/recordatorios', 'POST', input);
    expect(created.status).toBe(201);
    expect(validateResponse('G-08', 201, created.body).valid).toBe(true);
    expect(created.body.recordatorio.horas).toEqual(['08:00', '15:00']);
    const replay = await request('/recordatorios', 'POST', {
      ...input,
      horas: [...input.horas].reverse(),
      dias_semana: [...input.dias_semana].reverse(),
    });
    expect(replay.status).toBe(200);
    expect(replay.body.version_agenda).toBe(created.body.version_agenda);
    expect((await request('/recordatorios/' + input.id)).body.recordatorio).toEqual(
      created.body.recordatorio,
    );
  });
  it('resuelve altas concurrentes idénticas y neutraliza colisiones de propietario', async () => {
    const input = configuration();
    const results = await Promise.all(stores.map((s) => s.create(owner, input)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    await expect(stores[1]!.create(other, input)).rejects.toMatchObject({
      status: 409,
      code: 'OPERACION_EN_CONFLICTO',
    });
    expect((await request('/recordatorios/' + input.id, 'GET', undefined, other)).status).toBe(404);
    expect((await db.query('SELECT id FROM gw_reminder')).rowCount).toBe(1);
  });
  it('aplica una sola edición concurrente y no incrementa versión por no-op', async () => {
    const input = configuration();
    await request('/recordatorios', 'POST', input);
    const edits = await Promise.all(
      ['Edición A', 'Edición B'].map((titulo) =>
        request('/recordatorios/' + input.id, 'PUT', {
          ...input,
          id: undefined,
          titulo,
          version_esperada: 1,
        }),
      ),
    );
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = (await request('/recordatorios/' + input.id)).body as GatewayRecordatorioEnvelope;
    expect(after.recordatorio.version).toBe(2);
    const {
      id: ignoreId,
      version: ignoreVersion,
      creado_en: ignoreCreated,
      actualizado_en: ignoreUpdated,
      canal: ignoreChannel,
      respaldo_segundos: ignoreBackup,
      ...config
    } = after.recordatorio;
    void [ignoreId, ignoreVersion, ignoreCreated, ignoreUpdated, ignoreChannel, ignoreBackup];
    const noop = await request('/recordatorios/' + input.id, 'PUT', {
      ...config,
      version_esperada: 2,
    });
    expect(noop.status).toBe(200);
    expect(noop.body.version_agenda).toBe(after.version_agenda);
    expect((await request('/recordatorios', 'POST', input)).status).toBe(409);
    expect(
      (await db.query('SELECT version FROM gw_reminder_revision ORDER BY version')).rows,
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });
  it('recupera mediante GET un PUT aplicado cuya respuesta se ignoró', async () => {
    const input = configuration();
    await request('/recordatorios', 'POST', input);
    await request('/recordatorios/' + input.id, 'PUT', {
      ...input,
      id: undefined,
      titulo: 'Confirmado',
      version_esperada: 1,
    });
    const recovered = await request('/recordatorios');
    expect(recovered.body.recordatorios[0]).toMatchObject({
      id: input.id,
      titulo: 'Confirmado',
      version: 2,
    });
    expect(
      (
        await request('/recordatorios/' + input.id, 'PUT', {
          ...input,
          id: undefined,
          titulo: 'Confirmado',
          version_esperada: 1,
        })
      ).status,
    ).toBe(409);
  });
  it('conserva pausados, limita el intervalo inclusivo y rechaza invariantes de fecha', async () => {
    const input = { ...configuration(), activo: false };
    await request('/recordatorios', 'POST', input);
    expect(
      (await request('/recordatorios?desde=2026-10-01&hasta=2026-10-31')).body.recordatorios[0]
        .activo,
    ).toBe(false);
    for (const query of [
      'desde=2026-10-01',
      'desde=2026-10-01&hasta=2026-11-01',
      'desde=2026-10-29&hasta=2026-10-28',
    ])
      expect((await request('/recordatorios?' + query)).status).toBe(422);
    expect(
      (await request('/recordatorios', 'POST', { ...configuration(), fecha_fin: '2025-12-31' }))
        .status,
    ).toBe(422);
    expect(
      (await request('/recordatorios', 'POST', { ...configuration(), zona_horaria: 'UTC' })).status,
    ).toBe(422);
  });
  it('conserva tombstone y replay de DELETE sin resurrección ni incremento adicional', async () => {
    const input = configuration();
    await request('/recordatorios', 'POST', input);
    expect(
      (await request('/recordatorios/' + input.id + '?version_esperada=2', 'DELETE')).status,
    ).toBe(409);
    expect(
      (await request('/recordatorios/' + input.id + '?version_esperada=1', 'DELETE')).status,
    ).toBe(204);
    const after = await request('/recordatorios');
    expect(after.body.recordatorios).toEqual([]);
    expect(
      (await request('/recordatorios/' + input.id + '?version_esperada=99', 'DELETE')).status,
    ).toBe(204);
    expect((await request('/recordatorios')).body.version_agenda).toBe(after.body.version_agenda);
    expect((await request('/recordatorios', 'POST', input)).status).toBe(409);
    expect((await request('/recordatorios/' + input.id)).status).toBe(404);
    expect(
      (await db.query('SELECT deleted_at FROM gw_reminder WHERE id=$1', [input.id])).rows[0]
        ?.deleted_at,
    ).toBeTruthy();
  });
  it('serializa el límite de 100 por cuenta, incluidas reglas pausadas', async () => {
    for (let index = 0; index < 99; index++)
      await stores[index % 2]!.create(owner, { ...configuration(), activo: false });
    const boundary = await Promise.allSettled(
      stores.map((store) => store.create(owner, { ...configuration(), activo: false })),
    );
    expect(boundary.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(boundary.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = boundary.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({ status: 422 });
    await expect(stores[1]!.create(owner, configuration())).rejects.toMatchObject({ status: 422 });
    expect((await stores[0]!.list(owner)).recordatorios).toHaveLength(100);
    expect((await stores[1]!.create(other, configuration())).status).toBe(201);
  });
  it('conserva fecha original tardía y un solo efecto diario con replay exacto', async () => {
    const input = event(),
      registered = await request('/recordatorios/cumplimientos', 'POST', { items: [input] });
    expect(registered.status).toBe(200);
    expect(validateResponse('G-12', 200, registered.body).valid).toBe(true);
    const replay = await request('/recordatorios/cumplimientos', 'POST', { items: [input] });
    expect(replay.body.items[0].resultado).toBe('replay');
    expect(replay.body.version_agenda).toBe(registered.body.version_agenda);
    const again = await request('/recordatorios/cumplimientos', 'POST', {
      items: [{ ...input, operacion_id: randomUUID() }],
    });
    expect(again.body.items[0].resultado).toBe('registrado');
    expect(again.body.version_agenda).toBe(registered.body.version_agenda);
    const snapshot = await request(
      `/recordatorios?desde=${input.fecha_local}&hasta=${input.fecha_local}`,
    );
    expect(snapshot.body.cumplimientos).toEqual([
      {
        tipo_registro: 'signos',
        fecha_local: input.fecha_local,
        zona_horaria: 'America/Santiago',
        cumplido: true,
      },
    ]);
    expect((await db.query('SELECT count(*)::int n FROM gw_daily_state')).rows[0]?.n).toBe(1);
  });
  it('valida el lote completo y revierte una colisión descubierta después de otro item', async () => {
    const existing = event();
    await stores[0]!.complete(owner, { items: [existing] });
    const fresh = { ...event('00000000-0000-4000-8000-000000000001') };
    const result = await request('/recordatorios/cumplimientos', 'POST', {
      items: [fresh, { ...existing, tipo_registro: 'epro' }],
    });
    expect(result.status).toBe(409);
    expect(
      (
        await db.query('SELECT operation_id FROM gw_completion_event WHERE operation_id=$1', [
          fresh.operacion_id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await request('/recordatorios/cumplimientos', 'POST', { items: [fresh, fresh] })).status,
    ).toBe(422);
    const future = new Date(Date.now() + 360000).toISOString();
    expect(
      (
        await request('/recordatorios/cumplimientos', 'POST', {
          items: [{ ...fresh, registrado_en: future, fecha_local: agendaDate(future) }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request('/recordatorios/cumplimientos', 'POST', {
          items: [{ ...fresh, fecha_local: '2000-01-01' }],
        })
      ).status,
    ).toBe(422);
  });
  it('acepta respaldo local sin despacho remoto y acuse tardío revocado sin reactivación', async () => {
    const input = configuration(),
      created = await stores[0]!.create(owner, input),
      session = randomUUID();
    await db.query(
      "INSERT INTO gw_device(id,owner_id,installation_id,push_provider,push_token,platform,active,revoked_at) VALUES($1,$2,$3,'expo',$4,'android',false,now())",
      [session, owner, randomUUID(), 'synthetic-' + randomUUID()],
    );
    const date = agendaDate(Date.now() - 86400000),
      occurrence = reminderOccurrence(created.body.recordatorio, date, '08:00')!;
    const receipt = {
      operacion_id: randomUUID(),
      sesion_id: session,
      ocurrencia_id: occurrence.ocurrencia_id,
      evento: 'respaldo_observado',
      ocurrido_en: agendaInstant(date, '08:03'),
    };
    const first = await request('/notificaciones/acuses', 'POST', { items: [receipt] });
    expect(first.status).toBe(200);
    expect(validateResponse('G-13', 200, first.body).valid).toBe(true);
    expect(
      (await request('/notificaciones/acuses', 'POST', { items: [receipt] })).body.items[0]
        .resultado,
    ).toBe('replay');
    expect(
      (await db.query('SELECT active FROM gw_device WHERE id=$1', [session])).rows[0]?.active,
    ).toBe(false);
    expect((await db.query('SELECT count(*)::int n FROM gw_dispatch')).rows[0]?.n).toBe(0);
    expect(
      (
        await request(
          '/notificaciones/acuses',
          'POST',
          { items: [{ ...receipt, operacion_id: randomUUID() }] },
          other,
        )
      ).status,
    ).toBe(422);
  });
});

describe('Proxy de chat real: RAM en cliente, contrato y ausencia de reintentos automáticos', () => {
  it('envía solo mensaje actual, activar_alarmas true predeterminado y debug=false', async () => {
    const response = await request('/chatbot/consulta', 'POST', {
      mensaje: 'Mensaje sintético reservado',
    });
    expect(response.status).toBe(200);
    expect(validateResponse('G-06', 200, response.body).valid).toBe(true);
    expect(aiCalls).toBe(1);
    expect(aiPath).toBe('/api/v1/chat?debug=false');
    expect(aiBody).toEqual({ mensaje: 'Mensaje sintético reservado', activar_alarmas: true });
    expect(logs.join('')).not.toContain('Mensaje sintético reservado');
    expect(
      (await request('/chatbot/consulta', 'POST', { mensaje: 'hola', historial: [] })).status,
    ).toBe(422);
    expect(aiCalls).toBe(1);
  });
  it.each(['sin_informacion', 'cortesia', 'no_disponible', 'urgente'])(
    'preserva los campos del estado %s',
    async (mode) => {
      aiMode = mode;
      const response = await request('/chatbot/consulta', 'POST', {
        mensaje: 'hola',
        activar_alarmas: false,
      });
      expect(response.status).toBe(200);
      expect(response.body.estado_respuesta).toBe(mode === 'urgente' ? 'respuesta' : mode);
      expect(response.body.requiere_urgencia).toBe(mode === 'urgente');
      expect(response.body.fuentes).toHaveLength(1);
      expect(response.body.debug).toBeNull();
    },
  );
  it.each([
    ['invalid', 502, 'IA_RESPUESTA_INVALIDA'],
    ['timeout', 504, 'IA_TIEMPO_AGOTADO'],
  ])('devuelve error acotado %s sin repetir POST', async (mode, status, code) => {
    aiMode = String(mode);
    const response = await request('/chatbot/consulta', 'POST', { mensaje: 'hola' });
    expect(response.status).toBe(status);
    expect(response.body.error.codigo).toBe(code);
    expect(aiCalls).toBe(1);
  });
  it('conserva detail del error contractual y no lo persiste en logs', async () => {
    aiMode = 'error';
    const response = await request('/chatbot/consulta', 'POST', { mensaje: 'hola' });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ detail: 'Servicio sintético no disponible.' });
    expect(aiCalls).toBe(1);
  });
});

describe('Asociación de medicación confirmada y compartida', () => {
  it('conserva la asociación en PostgreSQL, respuesta, snapshot e historial de versión', async () => {
    const input = {
      ...configuration(),
      tipo: 'medicacion' as const,
      medicamento_paciente_id: medicationOwner,
    };
    const result = await request('/recordatorios', 'POST', input);
    expect(result.status).toBe(201);
    expect(result.body.recordatorio.medicamento_paciente_id).toBe(medicationOwner);
    expect((await request('/recordatorios')).body.recordatorios[0].medicamento_paciente_id).toBe(
      medicationOwner,
    );
    const persisted = await second.query(
      'SELECT patient_medication_id FROM gw_reminder WHERE id=$1',
      [input.id],
    );
    expect(persisted.rows[0].patient_medication_id).toBe(medicationOwner);
    const history = await second.query(
      'SELECT configuration FROM gw_reminder_revision WHERE reminder_id=$1',
      [input.id],
    );
    expect(history.rows[0].configuration.medicamento_paciente_id).toBe(medicationOwner);
    const replay = await request('/recordatorios', 'POST', input);
    expect(replay.status).toBe(200);
  });
  it('rechaza otra asignación o un medicamento inactivo sin crear avisos', async () => {
    const input = {
      ...configuration(),
      tipo: 'medicacion',
      medicamento_paciente_id: medicationOther,
    };
    expect((await request('/recordatorios', 'POST', input)).status).toBe(422);
    medicationActive = false;
    expect(
      (
        await request('/recordatorios', 'POST', {
          ...input,
          medicamento_paciente_id: medicationOwner,
        })
      ).status,
    ).toBe(422);
    expect((await db.query('SELECT count(*) n FROM gw_reminder')).rows[0].n).toBe('0');
  });
  it('un cliente anterior no borra el vínculo al editar, y permite pausar el aviso aunque el medicamento deje de estar activo', async () => {
    const input = {
      ...configuration(),
      tipo: 'medicacion' as const,
      medicamento_paciente_id: medicationOwner,
    };
    const created = await request('/recordatorios', 'POST', input);
    expect(created.status).toBe(201);
    const { id: ignored, ...oldInput } = configuration();
    void ignored;
    const edited = await request('/recordatorios/' + input.id, 'PUT', {
      ...oldInput,
      tipo: 'medicacion',
      horas: ['09:00'],
      version_esperada: 1,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.recordatorio.medicamento_paciente_id).toBe(medicationOwner);
    medicationActive = false;
    const paused = await request('/recordatorios/' + input.id, 'PUT', {
      ...edited.body.recordatorio,
      version_esperada: 2,
      activo: false,
      id: undefined,
      version: undefined,
      creado_en: undefined,
      actualizado_en: undefined,
      canal: undefined,
      respaldo_segundos: undefined,
    });
    expect(paused.status).toBe(200);
    expect(paused.body.recordatorio.activo).toBe(false);
  });
});
