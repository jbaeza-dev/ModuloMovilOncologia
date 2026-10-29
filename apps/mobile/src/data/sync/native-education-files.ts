import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { FileCipher } from './file-protection';
import type { SqlConnection } from '../local/core/sql';

/** Copy only DB-referenced legacy images into this environment; never remove the source. */
export async function scopeEducationalCopies(
  patientId: string,
  cipher: FileCipher,
  db: SqlConnection,
) {
  const legacy = new Directory(Paths.document, 'recursos_educativos', patientId);
  const legacyPrefix = legacy.uri.replace(/\/?$/, '/');
  const scoped = new Directory(cipher.directory!('recursos_educativos', patientId));
  scoped.create({ intermediates: true, idempotent: true });
  const rows = await db.all<{ contenido_id: string; ruta_local: string; formato: string }>(
    "SELECT contenido_id,ruta_local,formato FROM descarga WHERE paciente_id=? AND ruta_local IS NOT NULL AND formato IN ('png','jpeg')",
    [patientId],
  );
  for (const row of rows) {
    const path = row.ruta_local.replace(/\\/g, '/');
    if (!path.startsWith(legacyPrefix)) continue;
    const relative = path.slice(legacyPrefix.length);
    if (!/^[a-zA-Z0-9_.-]+\.(png|jpe?g)$/.test(relative) || relative.includes('..'))
      throw new Error('La imagen anterior requiere revisión de su ruta.');
    const original = new File(path);
    if (!original.exists) continue;
    const destination = new File(scoped, relative);
    const sourceBytes = await original.bytes();
    const sha = async (bytes: Uint8Array) =>
      Array.from(
        new Uint8Array(
          await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes)),
        ),
      )
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    const originalHash = await sha(sourceBytes);
    if (!destination.exists) {
      const temp = new File(scoped, relative + '.scope-' + Crypto.randomUUID() + '.tmp');
      const temporaryUri = temp.uri;
      try {
        await temp.write(sourceBytes);
        if ((await sha(await temp.bytes())) !== originalHash)
          throw new Error('La copia educativa no coincide con el original.');
        await temp.move(destination, { overwrite: false });
      } finally {
        // File.move mutates the source object's URI on Android. Clean only its original path.
        const originalTemporary = new File(temporaryUri);
        if (originalTemporary.exists) await originalTemporary.delete();
      }
    }
    if ((await sha(await destination.bytes())) !== originalHash)
      throw new Error('Hay dos imágenes anteriores diferentes; se conservan para revisión.');
    await db.run(
      'UPDATE descarga SET ruta_local=? WHERE paciente_id=? AND contenido_id=? AND ruta_local=?',
      [destination.uri, patientId, row.contenido_id, row.ruta_local],
    );
  }
}
