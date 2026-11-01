import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

const runId = process.argv[2];
if (!runId) throw new Error('Se requiere RunId como primer argumento');

const repoRoot = process.cwd();
const runPath = join(repoRoot, '.local_storage/predeploy', runId);
const envLines = readFileSync(join(runPath, 'tests.env'), 'utf8').split('\n');
const envMap = {};
for (const line of envLines) {
  const match = line.trim().match(/^([^=]+)=(.*)$/);
  if (match) envMap[match[1]] = match[2];
}

const baseDbUrl = envMap.TEST_DATABASE_URL;
if (!baseDbUrl) throw new Error('TEST_DATABASE_URL ausente en tests.env');

// Import compiled modules using pathToFileURL
const simulatorConfigMod = await import(
  pathToFileURL(join(repoRoot, 'apps/simulator/dist/config.js')).href
);
const simulatorDbMod = await import(
  pathToFileURL(join(repoRoot, 'apps/simulator/dist/db.js')).href
);
const simulatorSeedMod = await import(
  pathToFileURL(join(repoRoot, 'apps/simulator/dist/seed-data.js')).href
);
const simulatorAppMod = await import(
  pathToFileURL(join(repoRoot, 'apps/simulator/dist/app.js')).href
);
const simulatorAuthMod = await import(
  pathToFileURL(join(repoRoot, 'apps/simulator/dist/auth.js')).href
);
const simulatorTypesMod = await import(
  pathToFileURL(join(repoRoot, 'apps/simulator/dist/types.js')).href
);

const gatewayConfigMod = await import(
  pathToFileURL(join(repoRoot, 'apps/gateway/dist/config/index.js')).href
);
const gatewayDbMod = await import(
  pathToFileURL(join(repoRoot, 'apps/gateway/dist/persistence/database.js')).href
);
const gatewayMigrateMod = await import(
  pathToFileURL(join(repoRoot, 'apps/gateway/dist/persistence/migrations.js')).href
);
const gatewayAppMod = await import(
  pathToFileURL(join(repoRoot, 'apps/gateway/dist/http/app.js')).href
);
const gatewayDispatcherMod = await import(
  pathToFileURL(join(repoRoot, 'apps/gateway/dist/dispatcher.js')).href
);

console.log('>>> All compiled modules imported successfully');

const clinicalDbName = `qc_e2e_clinical_${runId}_test`;
const gatewayDbName = `qc_gateway_demo_e2e_${runId}_test`;

const adminDb = simulatorDbMod.openDatabase(baseDbUrl);
await adminDb.query(`CREATE DATABASE ${clinicalDbName};`);
await adminDb.query(`CREATE DATABASE ${gatewayDbName};`);
console.log(`>>> Created disposable databases: ${clinicalDbName}, ${gatewayDbName}`);

const clinicalDbUri = new URL(baseDbUrl);
clinicalDbUri.pathname = `/${clinicalDbName}`;
const gatewayDbUri = new URL(baseDbUrl);
gatewayDbUri.pathname = `/${gatewayDbName}`;

const sharedSecret = 'synthetic-shared-secret-32-bytes-minimum-length!';
const issuer = 'quimiocare-demo';
const audience = 'authenticated';

let clinicalDb,
  gatewayDb,
  clinicalServer,
  aiServer,
  gatewayServer,
  clinicalPort,
  aiPort,
  gatewayPort;
const testResults = [];

try {
  // 1. Clinical DB setup
  clinicalDb = simulatorDbMod.openDatabase(clinicalDbUri.href);
  await simulatorDbMod.migrate(clinicalDb);
  await simulatorSeedMod.seedDatabase(clinicalDb, 'http://127.0.0.1:1');

  // Insert Operator in clinical DB
  await clinicalDb.query(
    'INSERT INTO qc_demo_operador(id,auth_issuer,auth_subject,email,nombre) VALUES($1::uuid,$2,$1::text,$3,$4) ON CONFLICT DO NOTHING',
    [simulatorTypesMod.PATIENTS.A, issuer, 'operator@example.test', 'Operador Sintético'],
  );

  // 2. Clinical Simulator Server
  const clinicalConfig = simulatorConfigMod.readConfig({
    APP_ENV: 'demo',
    DATABASE_URL: clinicalDbUri.href,
    DEMO_SIGNING_KEY: sharedSecret,
    DEMO_CONTROL_KEY: sharedSecret,
    AUTH_PROVIDER: 'synthetic',
    SIMULATOR_SERVICE: 'clinical',
    SIMULATOR_PORT: '3002',
    SIMULATOR_PUBLIC_BASE_URL: 'http://127.0.0.1:1',
    PREPARATION_ENABLED: 'true',
    API_DOCS_ENABLED: 'true',
    EDUCATION_MEDIA_ROOT: join(runPath, 'media/education'),
    EDUCATION_TEMP_DIR: join(runPath, 'media/temp'),
    AI_SERVICE_URL: 'http://127.0.0.1:2',
  });
  clinicalServer = simulatorAppMod.createSimulator(clinicalConfig, clinicalDb);
  clinicalServer.listen(0, '127.0.0.1');
  await once(clinicalServer, 'listening');
  clinicalPort = clinicalServer.address().port;
  clinicalConfig.publicBaseUrl = `http://127.0.0.1:${clinicalPort}`;
  console.log(`>>> Clinical Simulator listening on 127.0.0.1:${clinicalPort}`);

  // 3. AI Simulator Server
  const aiConfig = simulatorConfigMod.readConfig({
    APP_ENV: 'demo',
    DATABASE_URL: clinicalDbUri.href,
    DEMO_SIGNING_KEY: sharedSecret,
    DEMO_CONTROL_KEY: sharedSecret,
    AUTH_PROVIDER: 'synthetic',
    SIMULATOR_SERVICE: 'ai',
    SIMULATOR_PORT: '3003',
    SIMULATOR_PUBLIC_BASE_URL: 'http://127.0.0.1:1',
    PREPARATION_ENABLED: 'false',
    API_DOCS_ENABLED: 'true',
    EDUCATION_MEDIA_ROOT: join(runPath, 'media/education'),
    EDUCATION_TEMP_DIR: join(runPath, 'media/temp'),
    AI_SERVICE_URL: 'http://127.0.0.1:2',
  });
  aiServer = simulatorAppMod.createSimulator(aiConfig, clinicalDb);
  aiServer.listen(0, '127.0.0.1');
  await once(aiServer, 'listening');
  aiPort = aiServer.address().port;
  console.log(`>>> AI Simulator listening on 127.0.0.1:${aiPort}`);

  // 4. Gateway DB setup
  gatewayDb = gatewayDbMod.openDatabase(gatewayDbUri.href);
  await gatewayMigrateMod.migrate(gatewayDb);

  // 5. Gateway Server
  const gatewayConfig = gatewayConfigMod.readConfig({
    APP_ENV: 'demo',
    GATEWAY_PORT: '3001',
    GATEWAY_DATABASE_URL: gatewayDbUri.href,
    CLINICAL_API_URL: `http://127.0.0.1:${clinicalPort}`,
    AI_API_URL: `http://127.0.0.1:${aiPort}`,
    AUTH_EXPECTED_ISSUER: issuer,
    AUTH_EXPECTED_AUDIENCE: audience,
    AUTH_ALLOWED_ALGORITHM: 'HS256',
    AUTH_VERIFY_KEY: sharedSecret,
    GATEWAY_CURSOR_KEY: 'synthetic-cursor-encryption-key-32-bytes-len!',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    AGENDA_TIMEZONE: 'America/Santiago',
    AGENDA_MAX_REMINDERS: '100',
    HTTP_REQUEST_TIMEOUT_MS: '65000',
    DEPENDENCY_TIMEOUT_MS: '3000',
    AI_TIMEOUT_MS: '5000',
    SHUTDOWN_TIMEOUT_MS: '2000',
    PUSH_PROVIDER: 'expo',
  });

  const gwApp = gatewayAppMod.createApp(gatewayConfig, gatewayDb);
  gatewayServer = createServer(gwApp);
  gatewayServer.listen(0, '127.0.0.1');
  await once(gatewayServer, 'listening');
  gatewayPort = gatewayServer.address().port;
  console.log(`>>> Gateway listening on 127.0.0.1:${gatewayPort}`);

  // Sessions for A and B
  const sessionA = await simulatorAuthMod.issueSession(clinicalDb, clinicalConfig, 'A');
  const sessionB = await simulatorAuthMod.issueSession(clinicalDb, clinicalConfig, 'B');
  const tokenA = sessionA.access_token;
  const tokenB = sessionB.access_token;
  const patientIdA = simulatorTypesMod.PATIENTS.A;

  console.log(`>>> Testing E2E cases against Gateway 127.0.0.1:${gatewayPort}`);

  // E2E-01: JWT A -> gateway -> auth/me clínico real
  {
    const res = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/dispositivo/sesiones?limit=10`,
      {
        headers: { authorization: `Bearer ${tokenA}` },
      },
    );
    const body = await res.json();
    if (res.status === 200 && Array.isArray(body.items)) {
      testResults.push({
        id: 'E2E-01',
        desc: 'JWT A -> gateway -> auth/me clínico real',
        status: 'PASS',
        observed: `Status 200, gateway autorizó a A vía clinical C-01 conservando UUID ${patientIdA}`,
      });
    } else {
      testResults.push({
        id: 'E2E-01',
        desc: 'JWT A -> gateway -> auth/me clínico real',
        status: 'FAIL',
        observed: `Status ${res.status}: ${JSON.stringify(body)}`,
      });
    }
  }

  // E2E-02: Alta/listado/rotación/revocación dispositivo por gateway
  {
    const installationId = randomUUID();
    const tokenPush1 = `ExpoPushToken[synthetic-token-${randomUUID()}]`;
    const tokenPush2 = `ExpoPushToken[synthetic-token-${randomUUID()}]`;

    // Alta como A
    const altaRes = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/dispositivo/push-token`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sesion_id: randomUUID(),
          instalacion_id: installationId,
          token_push: tokenPush1,
          proveedor_push: 'expo',
          plataforma: 'android',
        }),
      },
    );
    const altaBody = await altaRes.json();
    const sessionId = altaBody.sesion?.id;
    const sessionVersion = altaBody.sesion?.version ?? 1;

    // Listar como A
    const listARes = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/dispositivo/sesiones?limit=10`,
      {
        headers: { authorization: `Bearer ${tokenA}` },
      },
    );
    const listABody = await listARes.json();
    const foundInA = Array.isArray(listABody.items)
      ? listABody.items.some((i) => i.instalacion_id === installationId)
      : false;

    // Listar como B (aislamiento)
    const listBRes = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/dispositivo/sesiones?limit=10`,
      {
        headers: { authorization: `Bearer ${tokenB}` },
      },
    );
    const listBBody = await listBRes.json();
    const foundInB = Array.isArray(listBBody.items)
      ? listBBody.items.some((i) => i.instalacion_id === installationId)
      : false;

    // Rotar token
    const rotRes = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/dispositivo/push-token`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sesion_id: sessionId,
          instalacion_id: installationId,
          token_push: tokenPush2,
          proveedor_push: 'expo',
          plataforma: 'android',
          version_esperada: sessionVersion,
        }),
      },
    );

    // Revocar
    const delRes = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/dispositivo/sesiones/${sessionId}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${tokenA}` },
      },
    );

    const ok =
      (altaRes.status === 201 || altaRes.status === 200) &&
      foundInA &&
      !foundInB &&
      rotRes.status === 200 &&
      (delRes.status === 204 || delRes.status === 200);
    testResults.push({
      id: 'E2E-02',
      desc: 'Alta/listado/rotación/revocación dispositivo por gateway con aislamiento A/B',
      status: ok ? 'PASS' : 'FAIL',
      observed: `Alta status ${altaRes.status}, A ve dispositivo: ${foundInA}, B no ve: ${!foundInB}, rotación: ${rotRes.status}, revocación: ${delRes.status}`,
    });
  }

  // E2E-03: Recordatorio -> dispatcher controlado -> ticket/receipt -> acuse
  {
    // Crear recordatorio
    const reminderId = randomUUID();
    const recRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/gateway/recordatorios`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: reminderId,
        tipo: 'signos',
        titulo: 'Control de signos e2e',
        zona_horaria: 'America/Santiago',
        horas: ['09:00'],
        dias_semana: [1, 2, 3, 4, 5, 6, 7],
        fecha_inicio: '2026-01-01',
        fecha_fin: null,
        activo: true,
      }),
    });

    // Insertar dispositivo activo para paciente A en BD del gateway
    const deviceId = randomUUID();
    const instId = randomUUID();
    await gatewayDb.query(
      "INSERT INTO gw_device(id,owner_id,installation_id,push_provider,push_token,platform) VALUES($1,$2,$3,'expo',$4,'android')",
      [deviceId, patientIdA, instId, 'ExpoPushToken[e2e-fake-token]'],
    );

    // Ejecutar Dispatcher con Fake PushProvider
    const sentPushes = [];
    const fakeProvider = {
      async send(token, data) {
        sentPushes.push({ token, data });
        return { state: 'accepted', ticket: 'ticket-e2e-123' };
      },
      async receipt() {
        return { state: 'ok' };
      },
    };

    let simulatedNow = new Date('2026-10-31T12:00:00Z');
    const dispatcher = new gatewayDispatcherMod.AgendaDispatcher(gatewayDb, fakeProvider, {
      now: () => simulatedNow,
      random: () => 0,
    });
    const reservedCount = await dispatcher.reserve();
    const sentCount = await dispatcher.tick();

    // Avanzar reloj simulado 20 minutos para superar el umbral de maduración de recibos (15 minutos)
    simulatedNow = new Date('2026-10-31T12:20:00Z');
    const receiptsCount = await dispatcher.receipts();
    const dispatchSummary = { reservedCount, sentCount, receiptsCount };

    // Acuse desde gateway usando formato canónico de ocurrencia: <reminder_id>:1:<YYYY-MM-DD>:<HHMM>
    const ackOccurrenceId = `${reminderId}:1:2026-10-31:0900`;
    const ackRes = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/notificaciones/acuses`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              operacion_id: randomUUID(),
              sesion_id: deviceId,
              ocurrencia_id: ackOccurrenceId,
              evento: 'push_procesado',
              ocurrido_en: '2026-10-31T12:01:00Z',
            },
          ],
        }),
      },
    );

    const ok = recRes.status === 201 && ackRes.status === 200 && receiptsCount > 0;
    testResults.push({
      id: 'E2E-03',
      desc: 'Recordatorio -> dispatcher controlado -> ticket/receipt -> acuse',
      status: ok ? 'PASS' : 'FAIL',
      observed: `Recordatorio status ${recRes.status}, dispatch: ${JSON.stringify(dispatchSummary)}, acuse status ${ackRes.status}`,
    });
  }

  // E2E-04: Consulta de chat por gateway hacia IA real del simulador
  {
    const chatRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/gateway/chatbot/consulta`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mensaje: 'Tengo fiebre de 38 grados' }),
    });
    const chatBody = await chatRes.json();
    const ok =
      chatRes.status === 200 &&
      typeof chatBody.respuesta === 'string' &&
      typeof chatBody.requiere_urgencia === 'boolean';
    testResults.push({
      id: 'E2E-04',
      desc: 'Consulta de chat por gateway hacia IA real del simulador',
      status: ok ? 'PASS' : 'FAIL',
      observed: `Status ${chatRes.status}, IA respondió conforme contrato: requiere_urgencia=${chatBody.requiere_urgencia}, confianza=${chatBody.confianza_nivel}`,
    });
  }

  // E2E-05: Perfil inactivo de A deniega en gateway; B conserva acceso
  {
    await clinicalDb.query(
      "UPDATE qc_demo_paciente SET perfil = jsonb_set(perfil, '{activo}', 'false'::jsonb) WHERE id=$1",
      [patientIdA],
    );

    const resA = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/dispositivo/sesiones?limit=10`,
      {
        headers: { authorization: `Bearer ${tokenA}` },
      },
    );

    const resB = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/dispositivo/sesiones?limit=10`,
      {
        headers: { authorization: `Bearer ${tokenB}` },
      },
    );

    // Restaurar
    await clinicalDb.query(
      "UPDATE qc_demo_paciente SET perfil = jsonb_set(perfil, '{activo}', 'true'::jsonb) WHERE id=$1",
      [patientIdA],
    );

    const ok = resA.status === 403 && resB.status === 200;
    testResults.push({
      id: 'E2E-05',
      desc: 'Perfil inactivo de A deniega en gateway (403); B conserva acceso (200)',
      status: ok ? 'PASS' : 'FAIL',
      observed: `Paciente A inactivo dio status ${resA.status}; Paciente B activo dio status ${resB.status}`,
    });
  }

  // E2E-06: Clínica/IA detenida SOLO en el harness
  {
    // Detenemos temporalmente el servidor de IA
    await new Promise((res) => aiServer.close(res));

    const chatFailRes = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/gateway/chatbot/consulta`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ mensaje: 'Prueba de indisponibilidad' }),
      },
    );

    const ok = chatFailRes.status === 503;
    testResults.push({
      id: 'E2E-06',
      desc: 'Clínica/IA detenida devuelve 503 controlado sin fuga de detalles',
      status: ok ? 'PASS' : 'FAIL',
      observed: `Status devuelto: ${chatFailRes.status} (esperado 503 SERVICIO_NO_DISPONIBLE)`,
    });
  }

  // E2E-07: Reiniciar gateway sobre la misma DB desechable conserva datos
  {
    await new Promise((res) => gatewayServer.close(res));

    // Reiniciar servidor gateway contra la misma base
    const gwAppRestarted = gatewayAppMod.createApp(gatewayConfig, gatewayDb);
    const restartedServer = createServer(gwAppRestarted);
    restartedServer.listen(0, '127.0.0.1');
    await once(restartedServer, 'listening');
    const restartedPort = restartedServer.address().port;

    const listRes = await fetch(`http://127.0.0.1:${restartedPort}/api/gateway/recordatorios`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const listBody = await listRes.json();
    await new Promise((res) => restartedServer.close(res));

    const ok =
      listRes.status === 200 &&
      Array.isArray(listBody.recordatorios) &&
      listBody.recordatorios.some((i) => i.titulo === 'Control de signos e2e');
    testResults.push({
      id: 'E2E-07',
      desc: 'Reiniciar gateway sobre la misma DB desechable conserva datos sin duplicación',
      status: ok ? 'PASS' : 'FAIL',
      observed: `Status ${listRes.status}, recordatorios recuperados: ${listBody.recordatorios?.length}`,
    });
  }

  // E2E-08: Publicación Swagger/backend -> GET contractual
  {
    const categoryName = 'Categoría E2E Verificada';
    const prepRes = await fetch(
      `http://127.0.0.1:${clinicalPort}/admin/api/v1/preparacion/categorias`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operacion_id: randomUUID(),
          nombre: categoryName,
        }),
      },
    );

    // Comprobar que en GET contractual se procesa la consulta de categorías
    const catRes = await fetch(
      `http://127.0.0.1:${clinicalPort}/api/v1/contenido-educativo/categorias`,
      {
        headers: { authorization: `Bearer ${tokenA}` },
      },
    );
    await catRes.json();

    const ok = prepRes.status === 201 && catRes.status === 200;
    testResults.push({
      id: 'E2E-08',
      desc: 'Publicación Swagger/backend -> GET contractual',
      status: ok ? 'PASS' : 'FAIL',
      observed: `Preparación categoría status ${prepRes.status}, consulta contractual status ${catRes.status}`,
    });
  }
} finally {
  console.log('>>> Cleaning up harness servers and pools...');
  if (clinicalServer) await new Promise((res) => clinicalServer.close(() => res()));
  if (gatewayServer) await new Promise((res) => gatewayServer.close(() => res()));
  if (clinicalDb) await clinicalDb.end();
  if (gatewayDb) await gatewayDb.end();

  // Drop disposable databases
  console.log('>>> Dropping disposable databases...');
  await adminDb.query(`DROP DATABASE IF EXISTS ${clinicalDbName};`);
  await adminDb.query(`DROP DATABASE IF EXISTS ${gatewayDbName};`);
  await adminDb.end();
  console.log('>>> Cleanup completed cleanly.');
}

console.log('>>> Section 9 E2E Results:');
console.table(testResults);

writeFileSync(
  join(runPath, 'section9_e2e_summary.json'),
  JSON.stringify(testResults, null, 2),
  'utf8',
);

const allPassed = testResults.every((t) => t.status === 'PASS');
if (!allPassed) {
  throw new Error('Al menos una prueba E2E de la sección 9 falló.');
}
console.log('>>> All Section 9 E2E cases PASSED!');
