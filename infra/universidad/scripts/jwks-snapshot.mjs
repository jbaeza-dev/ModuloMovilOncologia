import { readFile, writeFile, rename, mkdir, lstat, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublicKeys } from './auth-ready.mjs';

export const lifetime = 43200000;
export function validateSnapshot(value, issuer, algorithm, now = Date.now()) {
  if (!['ES256', 'RS256'].includes(algorithm)) throw new Error('Unsupported signing algorithm.');
  if (
    !value ||
    value.schema !== 1 ||
    value.issuer !== issuer ||
    !Number.isSafeInteger(value.fetchedAt) ||
    value.fetchedAt < 0 ||
    value.fetchedAt > now + 30000 ||
    value.expiresAt !== value.fetchedAt + lifetime ||
    now >= value.expiresAt
  )
    throw new Error('JWKS snapshot expired, from another issuer, or invalid.');
  const url = new URL(issuer);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/auth/v1')
  )
    throw new Error('Invalid trusted issuer.');
  validatePublicKeys(value.jwks, algorithm);
  return value;
}
export async function readSnapshot(path, issuer, algorithm, now = Date.now()) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
    throw new Error('Invalid snapshot file.');
  return validateSnapshot(JSON.parse(await readFile(path, 'utf8')), issuer, algorithm, now);
}
export async function fetchSnapshot(issuer, algorithm, fetcher = fetch) {
  // Timestamp before the request: a slow transfer never extends trust.
  const fetchedAt = Date.now();
  const source = new URL(issuer + '/.well-known/jwks.json');
  if (
    source.protocol !== 'https:' ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  )
    throw new Error('Invalid JWKS source.');
  const response = await fetcher(source, {
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (
    response.status !== 200 ||
    !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(
      response.headers.get('content-type') || '',
    ) ||
    !response.body
  )
    throw new Error('JWKS source unavailable or invalid.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 60000) throw new Error('JWKS source exceeds limit.');
    chunks.push(chunk);
  }
  return validateSnapshot(
    {
      schema: 1,
      issuer,
      fetchedAt,
      expiresAt: fetchedAt + lifetime,
      jwks: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    },
    issuer,
    algorithm,
  );
}
export async function installSnapshot(source, directory, issuer, algorithm) {
  const next = await readSnapshot(source, issuer, algorithm);
  await mkdir(directory, { recursive: true, mode: 0o755 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Linked destination rejected.');
  const target = resolve(directory, 'snapshot.json');
  let old;
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
      throw new Error('Invalid previous snapshot file.');
    old = JSON.parse(await readFile(target, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (
    old &&
    (old.issuer !== issuer ||
      old.fetchedAt > next.fetchedAt ||
      (old.fetchedAt === next.fetchedAt && JSON.stringify(old) !== JSON.stringify(next)))
  )
    throw new Error('Snapshot rollback or conflicting replay.');
  const temporary = resolve(directory, 'snapshot-' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(next), { mode: 0o644, flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return !old || JSON.stringify(old.jwks) !== JSON.stringify(next.jwks);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, path, destination] = process.argv.slice(2);
    const issuer = process.env.AUTH_EXPECTED_ISSUER;
    const algorithm = process.env.AUTH_ALLOWED_ALGORITHM || 'ES256';
    if (action === 'fetch') {
      const snapshot = await fetchSnapshot(issuer, algorithm);
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, JSON.stringify(snapshot), { flag: 'wx', mode: 0o644 });
      console.log('JWKS snapshot fetched and validated.');
    } else if (action === 'install') {
      console.log(
        (await installSnapshot(path, destination, issuer, algorithm))
          ? 'KEYSET_CHANGED'
          : 'KEYSET_UNCHANGED',
      );
    } else if (action === 'validate') {
      await readSnapshot(path, issuer, algorithm);
      console.log('JWKS snapshot valid.');
    } else throw new Error('Explicit fetch, validate or install command required.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
