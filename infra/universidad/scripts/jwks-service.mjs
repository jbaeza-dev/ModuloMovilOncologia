import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot } from './jwks-snapshot.mjs';

export function createJwksServer({ path, issuer, algorithm, now = Date.now }) {
  return createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'GET' || !['/jwks.json', '/ready'].includes(req.url)) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    try {
      const value = await readSnapshot(path, issuer, algorithm, now());
      res.setHeader('x-qc-jwks-expires-at', String(value.expiresAt));
      res.writeHead(200);
      res.end(
        JSON.stringify(
          req.url === '/ready' ? { ready: true, expiresAt: value.expiresAt } : value.jwks,
        ),
      );
    } catch {
      res.writeHead(503);
      res.end('{"error":"JWKS_UNAVAILABLE"}');
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createJwksServer({
    path: '/snapshots/snapshot.json',
    issuer: process.env.AUTH_EXPECTED_ISSUER,
    algorithm: process.env.AUTH_ALLOWED_ALGORITHM,
  });
  server.listen(3004, '0.0.0.0');
  process.on('SIGTERM', () => {
    server.close();
    server.closeAllConnections();
  });
}
