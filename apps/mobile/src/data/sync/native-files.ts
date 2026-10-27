import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { FileCipher } from './file-protection';
import { encryptedFile } from './native-cipher';
import type { SqlConnection } from '../local/core/sql';

export async function migrateClinicalFiles(
  localPatientId: string,
  cipher: FileCipher,
  connection: SqlConnection,
  checkpoint: (phase: string) => Promise<void> = async () => undefined,
  includeLegacy = true,
) {
  const walk = async (directory: Directory): Promise<File[]> => {
    if (!directory.exists) return [];
    const files: File[] = [];
    for (const child of directory.list())
      if (child instanceof Directory) files.push(...(await walk(child)));
      else files.push(child);
    return files;
  };
  let converted = 0;
  for (const root of ['reportes_locales', 'formularios_locales']) {
    const family = root as 'reportes_locales' | 'formularios_locales';
    const scoped = new Directory(cipher.directory!(family, localPatientId));
    scoped.create({ intermediates: true, idempotent: true });
    const legacy = new Directory(Paths.document, root, localPatientId);
    const legacyPrefix = legacy.uri.replace(/\/?$/, '/');
    const roots = includeLegacy ? [legacy, scoped] : [scoped];
    const files = (await Promise.all(roots.map(walk))).flat();
    for (const file of files) {
      if (/\.qc-encrypt-[0-9a-f-]+\.tmp$/.test(file.name)) continue;
      if (!cipher.owns(file.uri)) throw new Error('Archivo fuera del contexto de migración.');
      const bytes = await file.bytes();
      if (encryptedFile(bytes)) {
        await cipher.unprotect(file.uri, bytes);
        if (file.uri.startsWith(legacyPrefix)) {
          const relative = file.uri.slice(legacyPrefix.length),
            destination = new File(scoped, relative);
          destination.parentDirectory.create({ intermediates: true, idempotent: true });
          if (destination.exists) {
            const previous = await cipher.unprotect(destination.uri, await destination.bytes());
            const incoming = await cipher.unprotect(file.uri, bytes);
            if (previous.length !== incoming.length || !previous.every((v, i) => v === incoming[i]))
              throw new Error('Existen dos versiones de un archivo; se requiere revisión.');
            file.delete();
          } else await file.move(destination);
        }
        continue;
      }
      const digest = Array.from(
        new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)),
      )
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      const journalId = 'file:' + file.uri;
      const temporary = new File(
        file.parentDirectory,
        file.name + '.qc-encrypt-' + Crypto.randomUUID() + '.tmp',
      );
      await connection.run(
        'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
        [
          journalId,
          JSON.stringify({ phase: 'preparado', sha256: digest, temporary: temporary.uri }),
        ],
      );
      await checkpoint('archivo_preparado');
      const sealed = await cipher.protect(file.uri, bytes);
      temporary.create({ overwrite: false });
      temporary.write(sealed);
      const restored = await cipher.unprotect(file.uri, await temporary.bytes());
      if (restored.length !== bytes.length || !restored.every((v, i) => v === bytes[i]))
        throw new Error('La copia cifrada no coincide con el original.');
      await checkpoint('archivo_verificado');
      await temporary.move(file, { overwrite: true });
      await connection.run('UPDATE qc_storage_control SET value_json=? WHERE id=?', [
        JSON.stringify({ phase: 'promovido', sha256: digest }),
        journalId,
      ]);
      await checkpoint('archivo_promovido');
      converted++;
      if (file.uri.startsWith(legacyPrefix)) {
        const relative = file.uri.slice(legacyPrefix.length),
          destination = new File(scoped, relative);
        destination.parentDirectory.create({ intermediates: true, idempotent: true });
        if (destination.exists)
          throw new Error('La migración no puede reemplazar un archivo distinto.');
        await file.move(destination);
      }
    }
    // Only discard a temporary duplicate after the promoted original authenticates successfully.
    for (const file of (await Promise.all(roots.map(walk))).flat()) {
      const match = file.name.match(/^(.*)\.qc-encrypt-[0-9a-f-]+\.tmp$/);
      if (!match) continue;
      let original = new File(file.parentDirectory, match[1]);
      if (!original.exists && file.uri.startsWith(legacyPrefix))
        original = new File(
          scoped,
          file.uri.slice(legacyPrefix.length).replace(/\.qc-encrypt-[0-9a-f-]+\.tmp$/, ''),
        );
      if (!original.exists || !encryptedFile(await original.bytes()))
        throw new Error('Archivo temporal pendiente de recuperación.');
      const current = await cipher.unprotect(original.uri, await original.bytes());
      const previous = await cipher.unprotect(original.uri, await file.bytes());
      if (current.length !== previous.length || !current.every((v, i) => v === previous[i]))
        throw new Error('La copia temporal contiene datos distintos y requiere revisión.');
      file.delete();
    }
  }
  return converted;
}
