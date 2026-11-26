import { sqliteDirectoryUri } from './native-paths';
import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { PowerSyncDatabase } from '@powersync/react-native';
import { Schema } from '@powersync/common';
import { createExpoConnection } from '../local/core/expo-connection';
import { migrateDatabase } from '../local/migrations';
import type { SqlConnection } from '../local/core/sql';
import { protectedKey } from './native-cipher';
import { createSyncConnection } from './sql-connection';
import { copyLegacyInventory, inventoryLegacy, verifyLegacyInventory } from './migration';

export const protectedDirectory = () => new Directory(Paths.document, 'qc_secure');
export const privateSyncLogger = { log: () => undefined };
let archiveJobs: Promise<void> = Promise.resolve();

export async function assertEncryptedDatabase(connection: SqlConnection) {
  const version = await connection.first<{ cipher_version: string }>('PRAGMA cipher_version');
  if (!version?.cipher_version) throw new Error('El almacenamiento nativo no acredita SQLCipher.');
  const integrity = await connection.first<{ integrity_check: string }>('PRAGMA integrity_check');
  if (integrity?.integrity_check !== 'ok')
    throw new Error('La base cifrada requiere recuperación.');
}

async function legacyFence(databaseName: string, hash: string) {
  const temporaryName = 'qc_fence_' + hash + '.db';
  const temporary = await SQLite.openDatabaseAsync(temporaryName);
  try {
    await temporary.execAsync('PRAGMA journal_mode=DELETE; PRAGMA user_version=2147483647;');
  } finally {
    await temporary.closeAsync();
  }
  const source = new File(sqliteDirectoryUri(SQLite.defaultDatabaseDirectory), temporaryName);
  const destination = new File(sqliteDirectoryUri(SQLite.defaultDatabaseDirectory), databaseName);
  // Same filesystem rename: the old build sees a recovery fence, never a new empty history.
  await source.move(destination, { overwrite: true });
  for (const suffix of ['-wal', '-shm']) {
    const file = new File(
      sqliteDirectoryUri(SQLite.defaultDatabaseDirectory),
      databaseName + suffix,
    );
    if (file.exists) file.delete();
  }
}

/** The encrypted archive preserves the complete old database; it is never connected to sync or exposed as an account repository. */
async function withArchive<T>(
  sourceEnvironment: string,
  work: (archive: SqlConnection) => Promise<T>,
): Promise<T> {
  const hash = (
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, sourceEnvironment)
  ).slice(0, 24);
  const markerKey = 'quimiocare.p04.archive.' + hash;
  const databaseName = 'quimiocare_production_' + hash + '.db';
  const directory = protectedDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, 'archive_' + hash + '.db');
  const marker = await SecureStore.getItemAsync(markerKey);
  if (marker && !file.exists)
    throw new Error(
      'Falta el archivo histórico cifrado; conserva los datos y solicita recuperación.',
    );
  const key = await protectedKey('archive:' + sourceEnvironment, file.exists || marker !== null);
  const archive = new PowerSyncDatabase({
    schema: new Schema({}),
    logger: privateSyncLogger,
    database: {
      dbFilename: file.name!,
      dbLocation: directory.uri.replace(/^file:\/\//, ''),
      sqliteOptions: { encryptionKey: key },
    },
  });
  let legacy: SQLite.SQLiteDatabase | null = null;
  try {
    await archive.waitForReady();
    const connection = createSyncConnection(archive);
    await assertEncryptedDatabase(connection);
    await migrateDatabase(connection);
    if (marker === null) {
      legacy = await SQLite.openDatabaseAsync(databaseName);
      const source = createExpoConnection(legacy);
      await migrateDatabase(source);
      const inventory = await inventoryLegacy(source, null);
      await copyLegacyInventory(inventory, connection);
      await verifyLegacyInventory(inventory, connection);
      await connection.run(
        'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
        [
          'archive',
          JSON.stringify({
            version: inventory.version,
            counts: inventory.tables.map((t) => ({ table: t.name, rows: t.rows.length })),
            sourceDigest: await Crypto.digestStringAsync(
              Crypto.CryptoDigestAlgorithm.SHA256,
              JSON.stringify(inventory),
            ),
          }),
        ],
      );
      await source.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      await legacy.closeAsync();
      legacy = null;
      await SecureStore.setItemAsync(markerKey, 'copiado', {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
    if (marker !== 'cercado') {
      await legacyFence(databaseName, hash);
      await SecureStore.setItemAsync(markerKey, 'cercado', {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
    return await work(connection);
  } finally {
    if (legacy) await legacy.closeAsync();
    await archive.close();
  }
}

export async function useLegacyArchive<T>(
  sourceEnvironment: string,
  work: (archive: SqlConnection) => Promise<T>,
): Promise<T> {
  const previous = archiveJobs;
  let release!: () => void;
  archiveJobs = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  try {
    return await withArchive(sourceEnvironment, work);
  } finally {
    release();
  }
}
