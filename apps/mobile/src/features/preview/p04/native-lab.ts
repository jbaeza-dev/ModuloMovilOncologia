import { runNativeRegressions } from './native-regressions';
import { sqliteDirectoryUri } from '../../../data/sync/native-paths';
import { open as openNativeDatabase } from '@op-engineering/op-sqlite';
import { migrateClinicalFiles } from '../../../data/sync/native-files';
import { ExpoBinaryReportStorageAdapter } from '../../../data/local/files/report-storage';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { HttpSessionAdapter } from '../../../services/session/http-session-adapter';
import { nativeVault } from '../../../services/session/native-session';
import { sessionConfig } from '../../../services/session/session-config';
import { DEMO_USERS } from '../../../services/session/demo-session-adapter';
import { createExpoConnection } from '../../../data/local/core/expo-connection';
import { createPatientRepository } from '../../../data/local/repository';
import { openClinicalStore, type ClinicalStore } from '../../../data/sync/native-runtime';
import { migrationPhases, inventoryLegacy } from '../../../data/sync/migration';
import {
  canonical,
  enqueueClinicalCommand,
  type ClinicalCommand,
} from '../../../data/sync/clinical-command';
import { createNativeFileCipher, encryptedFile } from '../../../data/sync/native-cipher';
import { protectClinicalFile, readClinicalFile } from '../../../data/sync/file-protection';
import { ClinicalConnector } from '../../../data/sync/clinical-connector';
import { saveContractEpro } from '../../../data/sync/clinical-repository';
import type { DefinitionSnapshot } from '../../../data/sync/catalog';

export interface LabArguments {
  run: string;
  action: string;
  patient: 'A' | 'B';
  phase?: string;
}
const actions = [
  'migrate',
  'resume',
  'zero',
  'sync',
  'signos',
  'epro',
  'cipher',
  'files',
  'filemigration',
  'partialcreate',
  'partialupload',
  'status',
  'regression',
] as const;
const expect = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
export async function runNativeLab(args: LabArguments) {
  expect(
    process.env.EXPO_PUBLIC_P04_PROBE_ENABLED === 'true' &&
      process.env.EXPO_PUBLIC_P04_LAB_ONLY === 'true' &&
      process.env.EXPO_PUBLIC_DEMO_MODE === 'true',
    'Laboratorio deshabilitado.',
  );
  expect(
    /^[a-z0-9-]{1,64}$/.test(args.run) &&
      actions.some((a) => a === args.action) &&
      ['A', 'B'].includes(args.patient),
    'Parámetros de laboratorio inválidos.',
  );
  const folder = new Directory(Paths.document, 'p04_lab');
  folder.create({ intermediates: true, idempotent: true });
  const reportFile = new File(folder, args.run + '_' + args.action + '_' + args.patient + '.json');
  const config = sessionConfig({
    APP_ENV: 'demo',
    CLINICAL_URL: process.env.EXPO_PUBLIC_CLINICAL_URL,
    GATEWAY_URL: process.env.EXPO_PUBLIC_GATEWAY_URL,
    AUTH_ISSUER: process.env.EXPO_PUBLIC_AUTH_ISSUER,
    AUTH_AUDIENCE: process.env.EXPO_PUBLIC_AUTH_AUDIENCE,
  });
  if (!config) throw new Error('Configura los endpoints de laboratorio.');
  const session = new HttpSessionAdapter({
    config,
    vault: nativeVault(config.scope + '|p04-lab:' + args.run + ':' + args.patient),
    newId: Crypto.randomUUID,
  });
  const localId = DEMO_USERS[args.patient === 'A' ? 0 : 1].id;
  const owner =
    args.patient === 'A'
      ? '964d32f1-6941-579f-9f08-b60342194da9'
      : '2dcb04f2-a2ad-5ea4-b711-9acd7e570002';
  const label = (
      await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, args.run)
    ).slice(0, 16),
    databaseName = 'qc_lab_' + label + '.db';
  let store: ClinicalStore | null = null;
  const result: Record<string, unknown> = {
    run: args.run,
    action: args.action,
    patient: args.patient,
    startedAt: new Date().toISOString(),
    passed: false,
  };
  try {
    const login = await session.selectDemoPatient(localId);
    expect(login.success, 'Falló D01 real.');
    if (session.getSnapshot().consent?.requiere_aceptacion) await session.acceptTerms();
    const cloneFile = new File(sqliteDirectoryUri(SQLite.defaultDatabaseDirectory), databaseName);
    if (!cloneFile.exists) {
      const target = await SQLite.openDatabaseAsync(databaseName);
      try {
        if (!['zero', 'regression'].includes(args.action)) {
          const source = await SQLite.openDatabaseAsync('quimiocare_local.db');
          try {
            expect(
              (await source.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))
                ?.user_version === 10,
              'El origen de pruebas debe ser la copia previa esquema 10.',
            );
            await SQLite.backupDatabaseAsync({ sourceDatabase: source, destDatabase: target });
          } finally {
            await source.closeAsync();
          }
          const snapshot = await inventoryLegacy(createExpoConnection(target), {
            owner,
            localPatientId: localId,
            environment: config.scope,
          });
          const expected = new File(folder, args.run + '_expected_' + args.patient + '.json');
          expected.write(
            JSON.stringify(
              await Promise.all(
                snapshot.tables.map(async (t) => ({
                  table: t.name,
                  rows: t.rows.length,
                  hash: await Crypto.digestStringAsync(
                    Crypto.CryptoDigestAlgorithm.SHA256,
                    canonical(t.rows),
                  ),
                })),
              ),
            ),
          );
        }
      } finally {
        await target.closeAsync();
      }
    }
    store = await openClinicalStore(session, localId, {
      databaseName,
      checkpoint: async (phase) => {
        if (args.phase === phase && migrationPhases.some((p) => p === args.phase))
          throw new Error('P04_INTERRUPCION:' + phase);
      },
    });
    const connection = store.connection;
    result.database = store.filename;
    result.cipherVersion = (
      await connection.first<{ cipher_version: string }>('PRAGMA cipher_version')
    )?.cipher_version;
    result.schema = (
      await connection.first<{ user_version: number }>('PRAGMA user_version')
    )?.user_version;
    const encrypted = new File(Paths.document, 'qc_secure', store.filename);
    result.encryptedHeader =
      new TextDecoder().decode((await encrypted.bytes()).slice(0, 16)) !== 'SQLite format 3\u0000';
    expect(result.encryptedHeader, 'La cabecera no está cifrada.');
    const snapshot = await inventoryLegacy(connection, store.scope);
    result.counts = snapshot.tables.map((t) => ({ table: t.name, rows: t.rows.length }));
    for (const table of snapshot.tables.filter((t) => t.columns.includes('paciente_id'))) {
      const other = await connection.first<{ n: number }>(
        'SELECT count(*) n FROM "' + table.name + '" WHERE paciente_id<>?',
        [localId],
      );
      expect(other?.n === 0, 'Se detectaron filas de otra cuenta.');
    }
    result.otherAccountRows = 0;
    const expected = new File(folder, args.run + '_expected_' + args.patient + '.json');
    if (expected.exists && ['migrate', 'resume', 'status'].includes(args.action)) {
      const rows = JSON.parse(await expected.text()) as {
        table: string;
        rows: number;
        hash: string;
      }[];
      for (const previous of rows) {
        const table = snapshot.tables.find((t) => t.name === previous.table);
        expect(table && table.rows.length === previous.rows, 'Conteo de migración diferente.');
        expect(
          (await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            canonical(table!.rows),
          )) === previous.hash,
          'Contenido de migración diferente.',
        );
      }
      result.originalRowsPreserved = true;
    }
    if (args.action === 'regression') {
      result.nativeRegression = await runNativeRegressions(
        store,
        session,
        databaseName,
        args.phase ?? '',
      );
    }
    if (['sync', 'epro'].includes(args.action)) {
      const requestedAt = Date.now();
      await store.resume(false);
      const timeout = new AbortController(),
        timer = setTimeout(() => timeout.abort(), 45000);
      try {
        await store.database.waitForFirstSync({ signal: timeout.signal });
      } finally {
        clearTimeout(timer);
      }
      const until = Date.now() + 45000;
      let fresh = false;
      while (Date.now() < until) {
        if ((store.database.currentStatus.lastSyncedAt?.getTime() ?? 0) < requestedAt) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        await store.settleCatalog();
        const row = await connection.first<{ completed_at: string; error_code: string | null }>(
          "SELECT * FROM qc_catalog_status WHERE id='catalog'",
        );
        if (row?.error_code) throw new Error(row.error_code);
        if (row?.completed_at && Date.parse(row.completed_at) >= requestedAt) {
          fresh = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(fresh, 'No llegó un checkpoint nuevo después de reconectar.');
      const counts = await connection.first<{ n: number }>(
        'SELECT count(*) n FROM qc_definition_snapshot',
      );
      expect((counts?.n ?? 0) >= 3, 'No se reconstruyeron las tres ediciones.');
      result.catalog = {
        forms: counts?.n,
        questions: (await connection.first<{ n: number }>('SELECT count(*) n FROM pregunta'))?.n,
        education: (
          await connection.first<{ n: number }>('SELECT count(*) n FROM contenido_educativo')
        )?.n,
        checkpoint: store.database.currentStatus.lastSyncedAt?.toISOString(),
        editions: await connection.all('SELECT id,retired FROM qc_definition_snapshot ORDER BY id'),
        educationalMetadata: await connection.all(
          'SELECT id,titulo,tipo FROM contenido_educativo ORDER BY id',
        ),
      };
      await store.disconnect();
    }
    if (args.action === 'signos') {
      let saved = await session.vault.read('p04-signos-capture');
      if (!saved) {
        saved = JSON.stringify({
          id: Crypto.randomUUID(),
          queue: Crypto.randomUUID(),
          capturedAt: new Date().toISOString(),
        });
        await session.vault.write('p04-signos-capture', saved);
      }
      const capture = JSON.parse(saved) as { id: string; queue: string; capturedAt: string };
      if (
        !(await connection.first('SELECT id FROM qc_clinical_command WHERE id=?', [capture.id]))
      ) {
        let first = true;
        await createPatientRepository(
          connection,
          localId,
          () => {
            if (first) {
              first = false;
              return capture.id;
            }
            return capture.queue;
          },
          () => capture.capturedAt,
          store.captureHook,
        ).createVitals({
          temperatura: 36.8,
          presion_sistolica: 120,
          presion_diastolica: 80,
          pulso: 72,
          saturacion_o2: 98,
        });
      }
      result.created = capture.id;
    }
    if (args.action === 'epro') {
      const row = await connection.first<{ snapshot_json: string }>(
        "SELECT snapshot_json FROM qc_definition_snapshot WHERE id='cd3d5bc3-7d2a-5adf-b5fb-f090a98cec5b'",
      );
      expect(row, 'Falta la edición técnica condicional.');
      const definition = JSON.parse(row!.snapshot_json) as DefinitionSnapshot;
      const questions = definition.questions.filter(
        (q) => !(q.configuracion as Record<string, unknown>).depende_de,
      );
      const answers = questions.map((q) => ({
        pregunta_id: String(q.id),
        valor:
          q.tipo === 'booleano'
            ? false
            : q.tipo === 'numerico' || q.tipo === 'escala_likert'
              ? 0
              : q.tipo === 'opcion_unica'
                ? String(
                    (q.opciones as Record<string, unknown>[])[0].codigo ??
                      (q.opciones as Record<string, unknown>[])[0].value,
                  )
                : 'Caso sintético P04',
      }));
      let saved = await session.vault.read('p04-epro-capture');
      if (!saved) {
        saved = JSON.stringify({ id: Crypto.randomUUID(), capturedAt: new Date().toISOString() });
        await session.vault.write('p04-epro-capture', saved);
      }
      const capture = JSON.parse(saved) as { id: string; capturedAt: string };
      await saveContractEpro(connection, store.scope, definition, {
        id: capture.id,
        fecha_respuesta: capture.capturedAt,
        respuestas: answers,
      });
      result.created = capture.id;
    }
    if (['partialcreate', 'partialupload'].includes(args.action)) {
      let saved = await session.vault.read('p04-partial-captures');
      if (!saved) {
        saved = JSON.stringify({
          first: Crypto.randomUUID(),
          second: Crypto.randomUUID(),
          capturedAt: new Date().toISOString(),
        });
        await session.vault.write('p04-partial-captures', saved);
      }
      const capture = JSON.parse(saved) as { first: string; second: string; capturedAt: string };
      result.batchIds = [capture.first, capture.second];
      if (args.action === 'partialcreate')
        await connection.transaction(async (tx) => {
          for (const id of [capture.first, capture.second]) {
            await tx.run(
              'INSERT OR IGNORE INTO signos_vitales(id,paciente_id,fecha_registro,temperatura,presion_sistolica,presion_diastolica,pulso,saturacion_o2) VALUES (?,?,?,36.7,120,80,72,98)',
              [id, localId, capture.capturedAt],
            );
            await enqueueClinicalCommand(tx, store!.scope, {
              kind: 'signos',
              capturedAt: capture.capturedAt,
              payload: {
                id,
                fecha_registro: capture.capturedAt,
                temperatura: 36.7,
                presion_arterial_sistolica: 120,
                presion_arterial_diastolica: 80,
                pulso: 72,
                saturacion_oxigeno: 98,
              },
            });
          }
        });
    }
    if (['signos', 'epro', 'partialupload'].includes(args.action)) {
      const connector = new ClinicalConnector(
        store.scope,
        process.env.EXPO_PUBLIC_POWERSYNC_URL!,
        session,
        connection,
        (code) => {
          result.pauseCode = code;
        },
      );
      for (let i = 0; i < 20; i++) {
        if ((await store.database.getUploadQueueStats()).count === 0) break;
        await connector.uploadData(store.database);
      }
      if (args.action !== 'partialupload') {
        const command = await connection.first<ClinicalCommand>(
          'SELECT * FROM qc_clinical_command WHERE id=?',
          [String(result.created)],
        );
        expect(command?.status === 'aceptado', 'La captura no obtuvo un ACK durable.');
        result.ackDurable = !!command?.ack_json;
        result.ackStatus = JSON.parse(command!.ack_json!).status;
      }
      result.pending = (await store.database.getUploadQueueStats()).count;
    }
    if (args.action === 'files') {
      const cipher = await createNativeFileCipher(store.scope.environment, owner, localId, true);
      const dir = new Directory(cipher.directory!('formularios_locales', localId), 'borradores');
      dir.create({ intermediates: true, idempotent: true });
      const file = new File(dir, 'p04_native_' + args.run + '.json'),
        plain = new TextEncoder().encode(JSON.stringify({ synthetic: true, marker: args.run }));
      file.write(await protectClinicalFile(file.uri, plain));
      expect(encryptedFile(await file.bytes()), 'Archivo sin cifrar.');
      expect(
        new TextDecoder().decode(await readClinicalFile(file.uri, await file.bytes())) ===
          new TextDecoder().decode(plain),
        'Reapertura de archivo no coincide.',
      );
      const wrong = await createNativeFileCipher(
        store.scope.environment,
        owner === '964d32f1-6941-579f-9f08-b60342194da9'
          ? '2dcb04f2-a2ad-5ea4-b711-9acd7e570002'
          : '964d32f1-6941-579f-9f08-b60342194da9',
        localId,
      );
      let denied = false;
      try {
        await wrong.unprotect(file.uri, await file.bytes());
      } catch {
        denied = true;
      }
      expect(denied, 'Otra clave pudo leer el archivo.');
      const tampered = await file.bytes();
      tampered[tampered.length - 1] ^= 1;
      denied = false;
      try {
        await cipher.unprotect(file.uri, tampered);
      } catch {
        denied = true;
      }
      expect(denied, 'No se detectó alteración del archivo.');
      result.fileEncryption = true;
      result.foreignKeyDenied = true;
      result.tamperDetected = true;
      const reports = new Directory(cipher.directory!('reportes_locales', localId));
      reports.create({ intermediates: true, idempotent: true });
      const adapter = new ExpoBinaryReportStorageAdapter();
      for (const extension of ['pdf', 'xlsx']) {
        const report = new File(reports, 'p04_binary_' + args.run + '.' + extension);
        await adapter.writeBytes(report.uri, plain);
        expect(encryptedFile(await report.bytes()), 'Reporte binario sin cifrar.');
        expect(
          canonical(Array.from(await readClinicalFile(report.uri, await report.bytes()))) ===
            canonical(Array.from(plain)),
          'No se pudo recuperar el reporte binario.',
        );
      }
      result.binaryReportEncryption = true;
    }
    if (args.action === 'filemigration') {
      const cipher = await createNativeFileCipher(store.scope.environment, owner, localId, true);
      const directory = new Directory(cipher.directory!('formularios_locales', localId));
      directory.create({ intermediates: true, idempotent: true });
      const file = new File(directory, 'migration_' + args.run + '.json');
      const plain = new TextEncoder().encode(JSON.stringify({ synthetic: true, marker: args.run }));
      if (!file.exists) file.write(plain);
      await migrateClinicalFiles(
        localId,
        cipher,
        connection,
        async (phase) => {
          if (phase === args.phase) throw new Error('P04_INTERRUPCION:' + phase);
        },
        false,
      );
      expect(encryptedFile(await file.bytes()), 'Archivo migrado sin cifrado.');
      expect(
        canonical(Array.from(await cipher.unprotect(file.uri, await file.bytes()))) ===
          canonical(Array.from(plain)),
        'La migración del archivo alteró su contenido.',
      );
      result.fileMigrationPreserved = true;
    }
    if (args.action === 'cipher') {
      const filename = store.filename;
      await store.close();
      store = null;
      for (const encryptionKey of [undefined, '0'.repeat(64)]) {
        let probe: ReturnType<typeof openNativeDatabase> | null = null,
          denied = false;
        try {
          probe = openNativeDatabase({
            name: filename,
            location: new Directory(Paths.document, 'qc_secure').uri.replace(/^file:\/\//, ''),
            encryptionKey,
          });
          probe.executeSync('SELECT count(*) FROM sqlite_master');
        } catch {
          denied = true;
        } finally {
          probe?.close();
        }
        expect(denied, 'Una apertura sin la clave correcta pudo leer la base.');
      }
      store = await openClinicalStore(session, localId, { databaseName });
      await store.connection.first('SELECT count(*) FROM signos_vitales');
      result.foreignDatabaseKeyDenied = true;
      result.unkeyedDatabaseReadDenied = true;
      result.authorizedReopen = true;
    }
    result.passed = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Error de laboratorio';
    result.expectedInterruption =
      typeof result.error === 'string' && result.error.startsWith('P04_INTERRUPCION:');
    if (store && !store.closed) {
      result.pending = (await store.database.getUploadQueueStats()).count;
      if (result.created)
        result.commandStatus = (
          await store.connection.first<ClinicalCommand>(
            'SELECT * FROM qc_clinical_command WHERE id=?',
            [String(result.created)],
          )
        )?.status;
    }
  } finally {
    if (store && Array.isArray(result.batchIds))
      result.batch = await Promise.all(
        (result.batchIds as string[]).map(async (id) => {
          const command = await store!.connection.first<ClinicalCommand>(
            'SELECT * FROM qc_clinical_command WHERE id=?',
            [id],
          );
          return {
            id,
            status: command?.status,
            ack: !!command?.ack_json,
            attempts: command?.attempts,
          };
        }),
      );
    if (store) await store.close().catch(() => undefined);
    result.finishedAt = new Date().toISOString();
    reportFile.write(JSON.stringify(result, null, 2));
  }
  return result;
}
