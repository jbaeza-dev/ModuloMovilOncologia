import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { ClinicalStore } from '../../../data/sync/native-runtime';
import { resourceContextLease } from '../../../data/sync/file-protection';
import { createPatientRepository } from '../../../data/local/repository';
import {
  ExpoFileStorageAdapter,
  type FileStorageAdapter,
} from '../../../data/local/files/file-storage-adapter';
import {
  isPathInPatientMediaDirectory,
  saveEducationalMediaWithCompensation,
} from '../../../data/local/files/educational-storage';
import { verifyStoredImage } from '../../../data/local/files/image-integrity';
import { computeSha256 } from '../../../utils/crypto';

/** Opt-in real-process crash checkpoints. Never used by an ordinary download. */
export async function runEducationalPromotionProbe(
  store: ClinicalStore,
  patientId: string,
  run: string,
  phase: string | undefined,
) {
  if (
    process.env.EXPO_PUBLIC_P04_PROBE_ENABLED !== 'true' ||
    process.env.EXPO_PUBLIC_DEMO_MODE !== 'true' ||
    !/^[a-z0-9-]{1,60}$/.test(run) ||
    !['before-promote', 'after-promote'].includes(phase ?? '') ||
    store.closed
  )
    throw new Error('Ensayo de archivos no autorizado.');
  const repository = createPatientRepository(store.connection, patientId, Crypto.randomUUID);
  const copy = await repository.education.getLocalCopy('f94ec6e8-791e-5202-84a1-f6edd1d7db6e');
  const originalUri = copy?.rutaAbsoluta ?? copy?.rutaRelativa;
  if (
    !copy ||
    !originalUri ||
    !isPathInPatientMediaDirectory(originalUri, patientId, copy.contentId)
  )
    throw new Error('Falta la copia original segura para el ensayo.');
  const original = await new File(originalUri).bytes();
  if (!(await verifyStoredImage(original, copy)))
    throw new Error('La copia original no pasó su verificación.');
  const directory = new Directory(Paths.document, 'p04_acceptance');
  directory.create({ intermediates: true, idempotent: true });
  const checkpoint = new File(directory, run + '_file-crash-checkpoint.json');
  if (checkpoint.exists) throw new Error('El identificador del ensayo ya fue usado.');
  const adapter = new ExpoFileStorageAdapter();
  const assertContext = resourceContextLease();
  const pause = async (orphanUri: string) => {
    assertContext();
    if (
      !isPathInPatientMediaDirectory(orphanUri, patientId) ||
      !orphanUri
        .split('/')
        .pop()
        ?.startsWith(copy.contentId + '.') ||
      !orphanUri.endsWith(phase === 'before-promote' ? '.tmp' : '.png')
    )
      throw new Error('Archivo fuera del contexto.');
    const bytes = await new File(orphanUri).bytes();
    checkpoint.write(
      JSON.stringify(
        {
          run,
          phase,
          checkpointReached: true,
          observedAt: new Date().toISOString(),
          owner: store.scope.owner,
          environment: store.scope.environment,
          contentId: copy.contentId,
          originalUri,
          orphanUri,
          originalSha256: await computeSha256(original),
          orphanSha256: await computeSha256(bytes),
          originalDownloadedAt: copy.descargadoEn,
          originalRevision: copy.metadataLocal?.versionOrigen,
          persistenceReached: false,
          clinicalCaptureCreated: false,
        },
        null,
        2,
      ),
    );
    // The host terminates this process after reading the checkpoint. If it does
    // not, bounded cancellation falls through ordinary compensation instead.
    await new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Ensayo cancelado sin cierre del proceso.')), 60000),
    );
  };
  const hooked: FileStorageAdapter = {
    exists: adapter.exists.bind(adapter),
    directoryExists: adapter.directoryExists.bind(adapter),
    readText: adapter.readText.bind(adapter),
    writeText: adapter.writeText.bind(adapter),
    readBinary: adapter.readBinary.bind(adapter),
    deleteFile: adapter.deleteFile.bind(adapter),
    listDirectory: adapter.listDirectory.bind(adapter),
    ensureDirectory: adapter.ensureDirectory.bind(adapter),
    writeBinary: async (uri, bytes) => {
      await adapter.writeBinary(uri, bytes);
      if (phase === 'before-promote') await pause(uri);
    },
    moveFile: async (from, to, options) => {
      await adapter.moveFile(from, to, options);
      if (phase === 'after-promote') await pause(to);
    },
  };
  await saveEducationalMediaWithCompensation({
    pacienteId: patientId,
    contenidoId: copy.contentId,
    formato: 'png',
    content: original,
    expectedBytes: original.length,
    expectedSha256: await computeSha256(original),
    mimeType: 'image/png',
    versionOrigen: copy.metadataLocal?.versionOrigen,
    textoAccesible: copy.metadataLocal?.textoAccesible ?? 'Imagen de prueba autorizada.',
    previousRutaLocal: originalUri,
    assertContext,
    adapter: hooked,
    // Every accepted phase pauses before this callback; never create a false
    // successful copy if a checkpoint is accidentally bypassed.
    persistCopyInTx: async () => {
      throw new Error('El ensayo no debe confirmar una descarga.');
    },
  });
}
