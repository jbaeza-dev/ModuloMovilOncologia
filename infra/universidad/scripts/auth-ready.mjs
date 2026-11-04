// Public-key dependency probe. No user session, API key or private key is required.
import { createPublicKey } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const limit = 64 * 1024;
const privateFields = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];
export function validatePublicKeys(document, expectedAlgorithm) {
  if (
    !document ||
    !Array.isArray(document.keys) ||
    !document.keys.length ||
    document.keys.length > 32
  )
    throw new Error('La autoridad no entregó un conjunto de claves públicas válido.');
  const identifiers = new Set();
  const algorithms = new Set();
  for (const key of document.keys) {
    if (
      !key ||
      typeof key !== 'object' ||
      typeof key.kid !== 'string' ||
      !key.kid ||
      identifiers.has(key.kid) ||
      privateFields.some((field) => field in key)
    )
      throw new Error('La autoridad entregó claves inválidas o ambiguas.');
    identifiers.add(key.kid);
    if (!['ES256', 'RS256'].includes(key.alg)) continue;
    if (
      (key.use && key.use !== 'sig') ||
      (key.key_ops &&
        (!Array.isArray(key.key_ops) ||
          !key.key_ops.includes('verify') ||
          key.key_ops.includes('sign')))
    )
      continue;
    if (
      (key.alg === 'ES256' && (key.kty !== 'EC' || key.crv !== 'P-256')) ||
      (key.alg === 'RS256' && key.kty !== 'RSA')
    )
      throw new Error('El algoritmo de una clave pública no coincide con su tipo.');
    try {
      createPublicKey({ key, format: 'jwk' });
    } catch {
      throw new Error('La autoridad entregó una clave pública que no se puede importar.');
    }
    algorithms.add(key.alg);
  }
  if (!algorithms.size || (expectedAlgorithm && !algorithms.has(expectedAlgorithm)))
    throw new Error('No hay claves públicas compatibles con el algoritmo configurado.');
  return { keys: identifiers.size, algorithms: [...algorithms].sort() };
}

export async function probeAuthAuthority(env = process.env, fetcher = fetch) {
  const raw = env.AUTH_JWKS_URL || env.PS_JWKS_URI;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Falta una URL válida de claves públicas.');
  }
  const distributed =
    env.AUTH_JWKS_MODE === 'distributed' && url.href === 'http://qc-jwks:3004/jwks.json';
  if ((!distributed && url.protocol !== 'https:') || url.username || url.password || url.hash)
    throw new Error('La autoridad de claves debe utilizar HTTPS sin credenciales en la URL.');
  if (env.AUTH_ALLOWED_ALGORITHM && !['ES256', 'RS256'].includes(env.AUTH_ALLOWED_ALGORITHM))
    throw new Error('El algoritmo de autenticación configurado no está permitido.');
  let response;
  try {
    response = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
  } catch {
    throw new Error(
      'No se pudo conectar de forma segura con la autoridad de claves. Revisar DNS, salida HTTPS y TLS.',
    );
  }
  if (response.status !== 200)
    throw new Error(`La autoridad de claves respondió HTTP ${response.status}.`);
  if (
    !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
  )
    throw new Error('La autoridad de claves no respondió con JSON.');
  if (Number(response.headers.get('content-length')) > limit || !response.body)
    throw new Error('Respuesta de claves públicas vacía o excesiva.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error('Respuesta de claves públicas excesiva.');
      chunks.push(Buffer.from(next.value));
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('No se pudo leer una respuesta de claves públicas completa y acotada.');
  }
  let document;
  try {
    document = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('La autoridad entregó JSON inválido.');
  }
  return validatePublicKeys(document, env.AUTH_ALLOWED_ALGORITHM);
}

if (!process.argv[1] || resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await probeAuthAuthority();
    console.log(
      `PASS: autoridad de autenticación accesible, ${result.keys} claves públicas, algoritmos ${result.algorithms.join(', ')}.`,
    );
  } catch (error) {
    console.error(`AUTH_DEPENDENCY_UNAVAILABLE: ${error.message}`);
    process.exitCode = 1;
  }
}
