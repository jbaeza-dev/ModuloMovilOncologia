import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { PowerSyncDatabase } from '@powersync/react-native';
import { clinicalSyncSchema } from '../../../data/sync/schema';
import { createSyncConnection } from '../../../data/sync/sql-connection';
import { migrateDatabase } from '../../../data/local/migrations';
import { createPatientRepository } from '../../../data/local/repository';
import { clinicalCaptureHook } from '../../../data/sync/legacy-command';
import { canonical, type ClinicalCommand } from '../../../data/sync/clinical-command';
import { ClinicalConnector } from '../../../data/sync/clinical-connector';
import { assertEncryptedDatabase, privateSyncLogger } from '../../../data/sync/native-archive';

const localPatientId = '11111111-1111-4111-8111-111111111111';
const expectedOwner = '964d32f1-6941-579f-9f08-b60342194da9';
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Real SQLCipher/SDK queue, connector and HTTP C-06. The connector callback is
 * invoked explicitly in this isolated lab; this does not claim a university stream. */
export async function runSdkHttpProbe(run: string): Promise<Record<string, unknown>> {
  check(
    process.env.EXPO_PUBLIC_APP_ENV === 'demo' &&
      process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW === 'true',
    'Laboratorio deshabilitado.',
  );
  const base = (process.env.EXPO_PUBLIC_P07_HTTP_PROBE_URL ?? '').replace(/\/$/, '');
  check(
    /^http:\/\/127\.0\.0\.1:3107$/.test(base),
    'Falta el endpoint local desechable del ensayo.',
  );
  const response = await fetch(base + '/__demo/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paciente_demo: 'A' }),
  });
  check(response.status === 200, 'No se obtuvo la sesión sintética local.');
  const auth = (await response.json()) as { access_token?: string; user?: { id?: string } };
  check(
    typeof auth.access_token === 'string' && auth.user?.id === expectedOwner,
    'Sesión de otro contexto.',
  );
  const token = auth.access_token;
  async function request(path: string, method: string, body?: unknown) {
    const result = await fetch(base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, body: (await result.json()) as unknown };
  }
  const terms = await request('/api/v1/terminos/vigente', 'GET');
  check(
    terms.status === 200 && terms.body && typeof terms.body === 'object' && 'id' in terms.body,
    'Faltan términos del servidor sintético.',
  );
  const consent = await request('/api/v1/pacientes/me/consentimientos', 'POST', {
    definicion_terminos_id: terms.body.id,
    operacion_id: Crypto.randomUUID(),
    codigo: 'TERMINOS_PLATAFORMA',
  });
  check(
    consent.status === 201 || consent.status === 200,
    'No se preparó el consentimiento sintético.',
  );
  const directory = new Directory(Paths.cache, 'p07_v4_sdk');
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, run + '.db');
  check(!file.exists, 'Conserva el intento anterior y utiliza otro identificador.');
  const key = Array.from(Crypto.getRandomBytes(32))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  const open = () =>
    new PowerSyncDatabase({
      schema: clinicalSyncSchema,
      logger: privateSyncLogger,
      database: {
        dbFilename: file.name!,
        dbLocation: directory.uri.replace(/^file:\/\//, ''),
        sqliteOptions: { encryptionKey: key },
      },
    });
  let database = open();
  const scope = { owner: expectedOwner, localPatientId, environment: 'p07-native-http-test' };
  const abort = new AbortController();
  let clinicalRequests = 0;
  const session = {
    getCurrentUser: () => ({ id: expectedOwner }),
    getContextSignal: () => abort.signal,
    credentialsForSync: async () => ({
      token,
      owner: expectedOwner,
      expiresAt: Date.now() + 30000,
      signal: abort.signal,
    }),
    request: async (_service: unknown, path: string, method: string, body: unknown) => {
      clinicalRequests++;
      return request(path, method, body);
    },
  } as unknown as ConstructorParameters<typeof ClinicalConnector>[2];
  try {
    await database.waitForReady();
    let db = createSyncConnection(database);
    await assertEncryptedDatabase(db);
    await migrateDatabase(db);
    const id = Crypto.randomUUID(),
      queueId = Crypto.randomUUID(),
      capturedAt = new Date().toISOString();
    const ids = [id, queueId];
    const repository = createPatientRepository(
      db,
      localPatientId,
      () => ids.shift()!,
      () => capturedAt,
      clinicalCaptureHook(scope),
    );
    await repository.createVitals({
      temperatura: 36.8,
      presion_sistolica: 120,
      presion_diastolica: 80,
      pulso: 72,
      saturacion_o2: 98,
      dolor_ena: 0,
    });
    const original = await db.first<ClinicalCommand>(
      'SELECT * FROM qc_clinical_command WHERE id=?',
      [id],
    );
    check(original && original.status === 'pendiente', 'No se conservó la captura pendiente.');
    const payload = canonical(JSON.parse(original.payload_json));
    const pending = await database.getNextCrudTransaction();
    check(
      pending?.crud.length === 1 &&
        pending.crud[0].id === id &&
        pending.crud[0].table === 'qc_upload_signos',
      'Falta la operación real del SDK.',
    );
    await new ClinicalConnector(scope, base, session, db, () => {}).uploadData(database);
    const accepted = await db.first<ClinicalCommand>(
      'SELECT * FROM qc_clinical_command WHERE id=?',
      [id],
    );
    check(accepted?.status === 'aceptado' && accepted.ack_json, 'No se conservó el ACK real.');
    const ack = JSON.parse(accepted.ack_json) as { status: number; body: Record<string, unknown> };
    check(
      ack.body.id === id &&
        ack.body.dolor_ena === 0 &&
        ack.body.version_dolor === 1 &&
        ack.body.fecha_registro === capturedAt,
      'El ACK alteró identidad, fecha o ENA.',
    );
    check(
      accepted.owner === scope.owner &&
        accepted.captured_at === capturedAt &&
        canonical(JSON.parse(accepted.payload_json)) === payload,
      'Cambió el snapshot original.',
    );
    check(
      (await database.getNextCrudTransaction()) === null,
      'La operación sigue pendiente después del ACK.',
    );
    await database.close();
    database = open();
    await database.waitForReady();
    db = createSyncConnection(database);
    await assertEncryptedDatabase(db);
    await migrateDatabase(db);
    const reopened = await db.first<ClinicalCommand>(
      'SELECT * FROM qc_clinical_command WHERE id=?',
      [id],
    );
    check(
      reopened?.status === 'aceptado' &&
        reopened.ack_json === accepted.ack_json &&
        reopened.payload_json === original.payload_json,
      'La reapertura perdió el ACK o cambió el snapshot.',
    );
    check(
      (await database.getNextCrudTransaction()) === null,
      'La reapertura recreó una operación.',
    );
    await new ClinicalConnector(scope, base, session, db, () => {}).uploadData(database);
    check(clinicalRequests === 1, 'La reapertura volvió a emitir una captura ya confirmada.');
    return {
      passed: true,
      captureId: id,
      capturedAt,
      payloadHash: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload),
      ownerPreserved: true,
      ENAZeroPreserved: true,
      encrypted: true,
      sdkPendingBefore: 1,
      sdkPendingAfter: 0,
      durableAckAfterReopen: true,
      clinicalRequests,
      ackStatus: ack.status,
      connectorInvokedExplicitly: true,
      streamConnected: false,
      universityServicesAccessed: false,
      scope:
        'Native SDK queue + real connector + HTTP C-06 against a disposable local PostgreSQL fixture; no original patient DB or automatic university stream',
    };
  } finally {
    abort.abort();
    await database.close();
  }
}
