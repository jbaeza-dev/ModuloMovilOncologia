import { scopeEducationalCopies } from './native-education-files';
import { cleanupRetiredEducationalCopies } from '../local/education/retired-copy-cleanup';
import * as Crypto from 'expo-crypto';
import { cleanupTransientReportExports } from '../local/files/report-storage';
import { File } from 'expo-file-system';
import { PowerSyncDatabase } from '@powersync/react-native';
import type { HttpSessionAdapter } from '../../services/session/http-session-adapter';
import { SessionFailure } from '../../services/session/http-session-types';
import { isUuid } from '../../services/session/response-checks';
import type { SqlConnection } from '../local/core/sql';
import { migrateDatabase } from '../local/migrations';
import { clinicalSyncSchema } from './schema';
import { createSyncConnection } from './sql-connection';
import { protectedKey, createNativeFileCipher } from './native-cipher';
import { activateFileCipher } from './file-protection';
import {
  useLegacyArchive,
  protectedDirectory,
  privateSyncLogger,
  assertEncryptedDatabase,
} from './native-archive';
import { migrateOwner } from './migration';
import { clinicalCaptureHook } from './legacy-command';
import { ClinicalConnector } from './clinical-connector';
import { publishCatalog } from './catalog';
import { migrateClinicalFiles } from './native-files';
import type { ClinicalScope } from './clinical-command';
import type { MigrationPhase } from './migration';

let transientExportsChecked = false;

export interface ClinicalStore {
  database: PowerSyncDatabase;
  connection: SqlConnection;
  scope: ClinicalScope;
  captureHook: ReturnType<typeof clinicalCaptureHook>;
  filename: string;
  closed: boolean;
  pauseCode: string | null;
  resume(retryPaused?: boolean): Promise<void>;
  disconnect(): Promise<void>;
  close(): Promise<void>;
  settleCatalog(): Promise<void>;
}
export function configuredSyncEndpoint(demo: boolean) {
  const raw = process.env.EXPO_PUBLIC_POWERSYNC_URL;
  if (!raw) return null;
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (demo && process.env.EXPO_PUBLIC_P04_PROBE_ENABLED === 'true' && url.protocol === 'http:')
    )
  )
    throw new Error('Configura una dirección segura para la sincronización.');
  return url.href.replace(/\/$/, '');
}

export async function openClinicalStore(
  session: HttpSessionAdapter,
  localPatientId: string,
  lab?: { databaseName: string; checkpoint?: (phase: MigrationPhase) => Promise<void> },
): Promise<ClinicalStore> {
  if (!transientExportsChecked) {
    cleanupTransientReportExports();
    transientExportsChecked = true;
  }
  const user = session.getCurrentUser();
  if (!user || !isUuid(user.id) || (user.localPatientId ?? user.id) !== localPatientId)
    throw new Error('El contexto de almacenamiento no coincide con la sesión.');
  const signal = session.getContextSignal(),
    demo = session.config.mode === 'demo',
    endpoint = configuredSyncEndpoint(demo);
  if (
    lab &&
    (!demo ||
      process.env.EXPO_PUBLIC_P04_PROBE_ENABLED !== 'true' ||
      process.env.EXPO_PUBLIC_P04_LAB_ONLY !== 'true' ||
      !/^qc_lab_[0-9a-f]{16}\.db$/.test(lab.databaseName))
  )
    throw new Error('El laboratorio requiere una compilación de prueba explícita.');
  const sourceEnvironment = session.config.scope + (lab ? '|lab:' + lab.databaseName : '');
  const scope = {
    owner: user.id,
    localPatientId,
    environment: sourceEnvironment + '|sync:' + (endpoint ?? 'unconfigured'),
  };
  const hash = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      scope.environment + '|' + scope.owner,
    )
  ).slice(0, 32);
  const directory = protectedDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const filename = 'clinical_' + hash + '.db',
    file = new File(directory, filename),
    existed = file.exists;
  const key = await protectedKey('database:' + scope.environment + ':' + scope.owner, existed);
  const cipher = await createNativeFileCipher(
    scope.environment,
    scope.owner,
    scope.localPatientId,
    existed,
  );
  const database = new PowerSyncDatabase({
    schema: clinicalSyncSchema,
    logger: privateSyncLogger,
    database: {
      dbFilename: filename,
      dbLocation: directory.uri.replace(/^file:\/\//, ''),
      sqliteOptions: { encryptionKey: key },
    },
  });
  const connection = createSyncConnection(database);
  let deactivate: () => void = () => undefined,
    unregisterSession: () => void = () => undefined,
    unregisterStatus: () => void = () => undefined;
  let projection: Promise<void> = Promise.resolve(),
    lastCheckpoint = 0,
    started = false;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const store: ClinicalStore = {
    database,
    connection,
    scope,
    filename,
    captureHook: clinicalCaptureHook(scope),
    closed: false,
    pauseCode: null,
    async settleCatalog() {
      await projection;
    },
    async disconnect() {
      if (started) {
        started = false;
        await database.disconnect();
      }
    },
    async resume(retryPaused = true) {
      if (store.closed || signal.aborted || session.getCurrentUser()?.id !== scope.owner) return;
      if (!endpoint) {
        store.pauseCode = 'SIN_CONFIGURACION';
        return;
      }
      if (retryPaused)
        await connection.run(
          "UPDATE qc_clinical_command SET status='pendiente',error_json=NULL WHERE owner=? AND environment=? AND status='pausado'",
          [scope.owner, scope.environment],
        );
      store.pauseCode = null;
      await connection.run("DELETE FROM qc_storage_control WHERE id='runtime:pause'");
      if (!started) {
        started = true;
        try {
          await database.connect(connector);
        } catch (error) {
          started = false;
          throw error;
        }
      }
    },
    async close() {
      if (store.closed) return;
      store.closed = true;
      if (pauseTimer) clearTimeout(pauseTimer);
      unregisterSession();
      unregisterStatus();
      deactivate();
      await store.disconnect();
      await projection.catch(() => undefined);
      await database.close();
    },
  };
  const connector = new ClinicalConnector(scope, endpoint ?? '', session, connection, (code) => {
    store.pauseCode = code;
    void connection
      .run(
        "INSERT INTO qc_storage_control(id,value_json) VALUES ('runtime:pause',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
        [JSON.stringify({ code })],
      )
      .catch(() => undefined);
    if (!pauseTimer)
      pauseTimer = setTimeout(() => {
        pauseTimer = undefined;
        void store.disconnect().catch(() => undefined);
      }, 0);
  });
  try {
    await database.waitForReady();
    await assertEncryptedDatabase(connection);
    await migrateDatabase(connection);
    await useLegacyArchive(
      sourceEnvironment,
      demo,
      (archive) => migrateOwner(archive, connection, scope, lab?.checkpoint),
      lab?.databaseName,
    );
    if (signal.aborted || session.getCurrentUser()?.id !== scope.owner)
      throw new Error('La cuenta cambió durante la apertura.');
    await connection.run(
      'INSERT OR IGNORE INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)',
      [localPatientId, user.name ?? 'Paciente', new Date().toISOString()],
    );
    await migrateClinicalFiles(localPatientId, cipher, connection, undefined, !lab);
    if (!lab) await scopeEducationalCopies(localPatientId, cipher, connection);
    deactivate = activateFileCipher(cipher);
    unregisterSession = session.registerConnector(() => store.disconnect());
    unregisterStatus = database.registerListener({
      statusChanged: (status) => {
        const checkpoint = status.lastSyncedAt?.getTime() ?? 0;
        if (store.closed || !status.hasSynced || status.downloading || checkpoint <= lastCheckpoint)
          return;
        lastCheckpoint = checkpoint;
        projection = projection.then(async () => {
          if (store.closed) return;
          try {
            await publishCatalog(
              database,
              connection,
              new Date(checkpoint).toISOString(),
              localPatientId,
            );
            await cleanupRetiredEducationalCopies(connection, localPatientId).catch(
              () => undefined,
            );
          } catch {
            if (!store.closed)
              await connection.run(
                "INSERT INTO qc_catalog_status(id,error_code) VALUES ('catalog','DEFINICION_INCOMPLETA') ON CONFLICT(id) DO UPDATE SET error_code=excluded.error_code",
              );
          }
        });
      },
    });
    const resumeOnConsent = session.subscribe(() => {
      if (
        !store.closed &&
        store.pauseCode?.startsWith('SESION_') &&
        session.getSnapshot().uploadAllowed
      )
        void store.resume(true).catch(() => undefined);
    });
    const unregister = unregisterSession;
    unregisterSession = () => {
      resumeOnConsent();
      unregister();
    };
    // Local data is available before network authorization; credentialsForSync gates actual uploads.
    if (!lab)
      void store.resume(false).catch((error) => {
        if (error instanceof SessionFailure) store.pauseCode = 'SESION_' + error.kind.toUpperCase();
      });
    return store;
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}
