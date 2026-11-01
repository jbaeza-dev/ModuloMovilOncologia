import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const issuer = process.env.AUTH_EXPECTED_ISSUER;
const key = process.env.AUTH_PUBLIC_KEY;
if (!issuer || !key || new URL(issuer).protocol !== 'https:')
  throw new Error('AUTH_EXPECTED_ISSUER HTTPS and AUTH_PUBLIC_KEY (publishable) required.');
const verifier = randomBytes(32).toString('base64url');
const state = randomBytes(32).toString('hex');
const redirect = new URL('http://127.0.0.1:3104/oauth/callback');
redirect.searchParams.set('qc_state', state);
const authorize = new URL(issuer + '/authorize');
authorize.searchParams.set('provider', 'google');
authorize.searchParams.set('redirect_to', redirect.href);
authorize.searchParams.set(
  'code_challenge',
  createHash('sha256').update(verifier).digest('base64url'),
);
authorize.searchParams.set('code_challenge_method', 's256');
let used = false;
const server = createServer((req, res) => {
  void (async () => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:3104');
    const supplied = Buffer.from(url.searchParams.get('qc_state') ?? '');
    if (
      used ||
      url.pathname !== '/oauth/callback' ||
      supplied.length !== state.length ||
      !timingSafeEqual(supplied, Buffer.from(state)) ||
      url.searchParams.getAll('code').length !== 1 ||
      url.searchParams.has('error')
    ) {
      res.writeHead(400);
      res.end('Invalid OAuth return. Restart the local tool.');
      return;
    }
    used = true;
    try {
      const response = await fetch(issuer + '/token?grant_type=pkce', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        headers: { apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify({ auth_code: url.searchParams.get('code'), code_verifier: verifier }),
      });
      if (!response.ok) throw new Error('Token exchange rejected.');
      const session = await response.json();
      if (
        typeof session.access_token !== 'string' ||
        !/^[A-Za-z0-9_.-]+$/.test(session.access_token)
      )
        throw new Error('Invalid session.');
      const directory = resolve('.local_storage');
      await mkdir(directory, { recursive: true });
      await writeFile(
        resolve(directory, 'operator-token.env'),
        'OPERATOR_ACCESS_TOKEN=' + session.access_token + '\n',
        { mode: 0o600 },
      );
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><title>QuimioCare</title><p>Sesion de evaluacion guardada localmente. Puede cerrar esta ventana.</p><script>history.replaceState(null,"","/oauth/completado")</script>',
      );
      console.log(
        'Access token saved to ignored .local_storage/operator-token.env. Refresh token was not stored.',
      );
    } catch {
      res.writeHead(502);
      res.end('Session could not be saved. Restart the tool.');
    } finally {
      server.close();
      clearTimeout(timer);
    }
  })().catch(() => {
    res.writeHead(500);
    res.end();
  });
});
const timer = setTimeout(() => server.close(), 10 * 60 * 1000);
server.listen(3104, '127.0.0.1', () => {
  console.log(
    'Authorize the callback manually in Supabase first: http://127.0.0.1:3104/oauth/callback?qc_state=*',
  );
  console.log('Open this URL in your browser (no Google secret is used):\n' + authorize.href);
});
