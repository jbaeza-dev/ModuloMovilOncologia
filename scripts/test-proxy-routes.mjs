// Real HTTP routing against both production Nginx configs; isolated Docker container only.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const temp = await mkdtemp(join(tmpdir(), 'qc-proxy-test-'));
const name = 'qc-proxy-test-' + randomUUID().slice(0, 8);
let institution;
const server = createServer((req, res) => {
  if (req.url === '/sync/stream') {
    if (req.headers.authorization !== 'Bearer synthetic-proxy-test') {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write('{"first":true}\n');
    setTimeout(() => res.end('{"last":true}\n'), 1200);
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      path: req.url,
      authorization: req.headers.authorization ?? null,
      upstream: req.headers['x-test-upstream'] ?? null,
    }),
  );
});
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
const port = server.address().port;
const versions = JSON.parse(await readFile('infra/universidad/versions.json', 'utf8'));
const nginx = versions.nginx.image + ':' + versions.nginx.tag + '@' + versions.nginx.digest;
try {
  for (const filename of ['gateway', 'simulator']) {
    let source = await readFile('infra/universidad/proxy/' + filename + '.conf', 'utf8');
    // Distinguish upstream selection as well as rewritten paths.
    for (const [svc, p] of [
      ['qc-clinical', 3002],
      ['qc-ai', 3003],
      ['qc-gateway', 3001],
      ['qc-powersync', 8080],
    ])
      source = source.replaceAll(
        'proxy_pass http://' + svc + ':' + p,
        'proxy_set_header X-Test-Upstream ' +
          svc +
          ';\n        proxy_pass http://host.docker.internal:' +
          port,
      );
    await writeFile(join(temp, filename + '.conf'), source);
  }
  execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--add-host',
      'host.docker.internal:host-gateway',
      '-p',
      '127.0.0.1::8018',
      '-p',
      '127.0.0.1::8019',
      '--mount',
      'type=bind,source=' + resolve(temp) + ',target=/etc/nginx/conf.d,readonly',
      nginx,
    ],
    { stdio: 'pipe' },
  );
  const hostPort = (internal) =>
    execFileSync('docker', ['port', name, String(internal) + '/tcp'], { encoding: 'utf8' })
      .trim()
      .split(':')
      .at(-1);
  const clinical = 'http://127.0.0.1:' + hostPort(8018),
    gateway = 'http://127.0.0.1:' + hostPort(8019);
  // Reproduce Parra: HTTPS is terminated outside and the assigned prefix is stripped.
  institution = createServer((req, res) => {
    const prefix = req.url.startsWith('/quimiocare-backend/')
      ? '/quimiocare-backend'
      : '/quimiocare';
    const target = prefix === '/quimiocare' ? clinical : gateway;
    const upstream = request(
      target + req.url.slice(prefix.length),
      { method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https' } },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  await new Promise((resolve) => institution.listen(0, '127.0.0.1', resolve));
  const publicBase = 'http://127.0.0.1:' + institution.address().port;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const r = await fetch(gateway + '/healthz');
      if (r.ok) break;
    } catch {
      /* container starting */
    }
    if (attempt === 29) throw Error('Proxy startup timed out');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  for (const [base, path, expected, upstream] of [
    [
      clinical,
      '/quimiocare/educacion/api/v1/podcasts',
      '/educacion/api/v1/podcasts',
      'qc-clinical',
    ],
    [
      publicBase,
      '/quimiocare/educacion/api/v1/podcasts',
      '/educacion/api/v1/podcasts',
      'qc-clinical',
    ],
    [clinical, '/quimiocare/api/v1/pacientes', '/api/v1/pacientes', 'qc-clinical'],
    [clinical, '/quimiocare/api/v1/chat', '/api/v1/chat', 'qc-ai'],
    [
      clinical,
      '/quimiocare/admin/api/v1/preparacion/categorias',
      '/admin/api/v1/preparacion/categorias',
      'qc-clinical',
    ],
    [gateway, '/quimiocare-backend/api/gateway/upload', '/api/gateway/upload', 'qc-gateway'],
    [gateway, '/quimiocare-backend/health', '/health', 'qc-gateway'],
    [
      publicBase,
      '/quimiocare/api/v1/pacientes?limite=2',
      '/api/v1/pacientes?limite=2',
      'qc-clinical',
    ],
    [publicBase, '/quimiocare/api/v1/chat', '/api/v1/chat', 'qc-ai'],
    [
      publicBase,
      '/quimiocare/admin/api/v1/preparacion/categorias',
      '/admin/api/v1/preparacion/categorias',
      'qc-clinical',
    ],
    [publicBase, '/quimiocare/docs/preparacion/', '/quimiocare/docs/preparacion/', 'qc-clinical'],
    [
      publicBase,
      '/quimiocare/docs/preparacion/oauth/callback?code=synthetic&qc_state=test',
      '/quimiocare/docs/preparacion/oauth/callback?code=synthetic&qc_state=test',
      'qc-clinical',
    ],
    [
      publicBase,
      '/quimiocare/docs/preparacion/preparation-auth.js',
      '/quimiocare/docs/preparacion/preparation-auth.js',
      'qc-clinical',
    ],
    [
      publicBase,
      '/quimiocare/docs/preparacion/openapi.json',
      '/quimiocare/docs/preparacion/openapi.json',
      'qc-clinical',
    ],
    [publicBase, '/quimiocare/admin', '/quimiocare/admin', 'qc-clinical'],
    [
      publicBase,
      '/quimiocare/archivos/educacion/test.png',
      '/archivos/educacion/test.png',
      'qc-clinical',
    ],
    [publicBase, '/quimiocare-backend/api/gateway/upload', '/api/gateway/upload', 'qc-gateway'],
    [publicBase, '/quimiocare-backend/docs/openapi.json', '/docs/openapi.json', 'qc-gateway'],
    [publicBase, '/quimiocare-backend/health', '/health', 'qc-gateway'],
  ]) {
    const response = await fetch(base + path, {
      headers: { Authorization: 'Bearer synthetic-proxy-test' },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200, path);
    const body = await response.json();
    assert.equal(body.path, expected, path);
    assert.equal(body.upstream, upstream, path);
    if (!path.endsWith('/health')) assert.equal(body.authorization, 'Bearer synthetic-proxy-test');
  }
  for (const [base, path] of [
    [clinical, '/__demo/reset'],
    [gateway, '/internal/ready'],
    [gateway, '/sync/api/admin/v1/diagnostics'],
    [gateway, '/quimiocare-backend/sync/api/admin/v1/diagnostics'],
    [publicBase, '/quimiocare/__demo/reset'],
    [publicBase, '/quimiocare-backend/internal/ready'],
    [publicBase, '/quimiocare-backend/sync/api/admin/v1/diagnostics'],
  ])
    assert.equal((await fetch(base + path)).status, 404, path);
  for (const base of [gateway, publicBase]) {
    assert.equal(
      (await fetch(base + '/quimiocare-backend/sync/stream', { method: 'POST', body: '{}' }))
        .status,
      401,
    );
    const start = Date.now();
    const streaming = await fetch(base + '/quimiocare-backend/sync/stream', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-proxy-test' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(streaming.status, 200);
    const reader = streaming.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /first/);
    assert.ok(
      Date.now() - start < 1000,
      'Streaming must reach the client before the upstream ends',
    );
    while (!(await reader.read()).done) {
      /* drain isolated test stream */
    }
  }
  console.log(
    'PASS: production proxies, prefix stripping once, bearer forwarding, streaming and internal-route blocking.',
  );
} finally {
  if (institution) await new Promise((resolve) => institution.close(resolve));
  try {
    execFileSync('docker', ['stop', name], { stdio: 'pipe' });
  } catch {
    /* never started */
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
