import * as Crypto from 'expo-crypto';

export async function computeSha256(content: string): Promise<string> {
  try {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
  } catch {
    if (typeof globalThis.crypto?.subtle?.digest === 'function') {
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    try {
      const nodeCrypto = await import('node:crypto');
      return nodeCrypto.createHash('sha256').update(content, 'utf8').digest('hex');
    } catch {
      throw new Error('No se pudo calcular la huella criptográfica SHA-256.');
    }
  }
}
