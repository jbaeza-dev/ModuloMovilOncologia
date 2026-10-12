import * as Crypto from 'expo-crypto';

export type BinaryOrTextContent = string | Uint8Array | ArrayBuffer;

export async function computeSha256(content: BinaryOrTextContent): Promise<string> {
  const isString = typeof content === 'string';

  if (isString) {
    try {
      return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
    } catch {
      // Fallback
    }
  }

  if (!isString && typeof Crypto.digest === 'function') {
    try {
      const buffer = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        content as unknown as BufferSource,
      );
      const hashArray = Array.from(new Uint8Array(buffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback
    }
  }

  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    try {
      const data: BufferSource = isString
        ? new TextEncoder().encode(content)
        : content instanceof Uint8Array
          ? (content as unknown as BufferSource)
          : new Uint8Array(content);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback
    }
  }

  try {
    const nodeCrypto = await import('node:crypto');
    if (isString) {
      return nodeCrypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }
    const rawBuffer = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content instanceof Uint8Array ? content : new Uint8Array(content));
    return nodeCrypto.createHash('sha256').update(rawBuffer).digest('hex');
  } catch {
    throw new Error('No se pudo calcular la huella criptográfica SHA-256.');
  }
}
