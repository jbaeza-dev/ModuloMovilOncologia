import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Paths } from 'expo-file-system';
import type { FileCipher } from './file-protection';

const locks = new Map<string, Promise<string>>();
export async function protectedKey(namespace: string, mustExist = false): Promise<string> {
  const keyName =
    'quimiocare.p04.' +
    (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, namespace));
  const pending = locks.get(keyName);
  if (pending) return pending;
  const operation = (async () => {
    const existing = await SecureStore.getItemAsync(keyName);
    if (existing !== null) {
      if (!/^[0-9a-f]{64}$/i.test(existing))
        throw new Error('La clave local requiere recuperación.');
      return existing;
    }
    if (mustExist)
      throw new Error('Falta la clave de los datos existentes; se requiere recuperación.');
    const key = await Crypto.AESEncryptionKey.generate(Crypto.AESKeySize.AES256);
    const encoded = await key.encoded('hex');
    await SecureStore.setItemAsync(keyName, encoded, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if ((await SecureStore.getItemAsync(keyName)) !== encoded)
      throw new Error('No se pudo conservar la clave local.');
    return encoded;
  })();
  locks.set(keyName, operation);
  try {
    return await operation;
  } finally {
    locks.delete(keyName);
  }
}
const magic = new TextEncoder().encode('QCAES1\n');
export function encryptedFile(bytes: Uint8Array): boolean {
  return magic.every((v, i) => bytes[i] === v);
}
export async function createNativeFileCipher(
  environment: string,
  owner: string,
  localPatientId: string,
  mustExist = false,
): Promise<FileCipher> {
  const key = await Crypto.AESEncryptionKey.import(
    await protectedKey('files:' + environment + ':' + owner, mustExist),
    'hex',
  );
  const aad = new TextEncoder().encode('QuimioCare:files:1:' + environment + ':' + owner);
  const directoryHash = (
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, environment)
  ).slice(0, 24);
  const documentRoot = decodeURIComponent(Paths.document.uri).replace(/\/?$/, '/');
  return {
    directory(root, patientId) {
      if (patientId !== localPatientId)
        throw new Error('El directorio no pertenece al contexto activo.');
      return documentRoot + root + '/' + directoryHash + '/' + localPatientId + '/';
    },
    owns(path) {
      try {
        const normalized = decodeURIComponent(path.replace(/\\/g, '/'));
        return (
          ['reportes_locales', 'formularios_locales'].some(
            (name) =>
              normalized.startsWith(documentRoot + name + '/' + localPatientId + '/') ||
              normalized.startsWith(
                documentRoot + name + '/' + directoryHash + '/' + localPatientId + '/',
              ),
          ) && !normalized.split('/').some((part) => part === '..')
        );
      } catch {
        return false;
      }
    },
    async protect(_path, plaintext) {
      const sealed = await Crypto.aesEncryptAsync(plaintext, key, {
        additionalData: aad,
        nonce: { length: 12 },
        tagLength: 16,
      });
      const combined = await sealed.combined();
      const result = new Uint8Array(magic.length + combined.length);
      result.set(magic);
      result.set(combined, magic.length);
      return result;
    },
    async unprotect(_path, ciphertext) {
      if (!encryptedFile(ciphertext)) throw new Error('El archivo requiere la migración cifrada.');
      return Crypto.aesDecryptAsync(
        Crypto.AESSealedData.fromCombined(ciphertext.slice(magic.length)),
        key,
        { additionalData: aad },
      );
    },
  };
}
