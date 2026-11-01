// Disposable local recovery rehearsal. Never uses an active sync database or instance.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = new URL(process.env.TEST_DATABASE_URL ?? '');
if (!/^\/qc_[a-z0-9_]+_test$/.test(source.pathname))
  throw new Error('Explicit disposable TEST_DATABASE_URL required.');
const suffix = randomUUID().replaceAll('-', '');
const sourceName = 'qc_recovery_' + suffix + '_test';
const storageName = 'qc_sync_' + suffix + '_test';
const container = 'qc-recovery-' + suffix;
const directory = await mkdtemp(join(tmpdir(), 'qc-sync-recovery-'));
const admin = new pg.Client({ connectionString: source.href });
let createdSource = false,
  createdStorage = false,
  createdContainer = false;
const docker = (...args) => {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Docker recovery test operation failed: ' + args[0]);
  }
};
const upstream = new URL(source.href);
upstream.hostname = process.env.TEST_DATABASE_DOCKER_HOST ?? 'host.docker.internal';
await admin.connect();
try {
  // Template must be idle. Fails explicitly rather than disconnecting another process.
  await admin.query(`CREATE DATABASE ${sourceName} TEMPLATE ${source.pathname.slice(1)}`);
  createdSource = true;
  await admin.query(`CREATE DATABASE ${storageName}`);
  createdStorage = true;
  const copyUrl = new URL(source.href);
  copyUrl.pathname = '/' + sourceName;
  const copy = new pg.Client({ connectionString: copyUrl.href });
  await copy.connect();
  try {
    await copy.query(
      'CREATE PUBLICATION powersync FOR TABLE contenido_educativo,formulario,pregunta,qc_demo_paciente',
    );
  } finally {
    await copy.end();
  }
  const config = `replication:
  connections:
    - type: postgresql
      uri: !env PS_SOURCE_URI
      sslmode: disable
storage:
  type: postgresql
  uri: !env PS_STORAGE_URI
  sslmode: disable
port: 8080
sync_config:
  path: /config/sync-config.yaml
client_auth:
  jwks:
    keys:
      - kty: oct
        k: c3ludGhldGljLXJlY292ZXJ5LXRlc3Qta2V5LTMya2V5
        alg: HS256
        kid: recovery-test-only
  audience: [authenticated]
api:
  tokens: [synthetic-recovery-test-admin-not-production]
telemetry:
  disable_telemetry_sharing: true
healthcheck:
  probes:
    use_http: true
system:
  logging:
    level: warn
    format: json
`;
  await writeFile(join(directory, 'service.yaml'), config);
  await writeFile(
    join(directory, 'sync-config.yaml'),
    await readFile(new URL('../infra/universidad/powersync/sync-config.yaml', import.meta.url)),
  );
  upstream.pathname = '/' + sourceName;
  const storageUrl = new URL(upstream.href);
  storageUrl.pathname = '/' + storageName;
  const versions = JSON.parse(
    await readFile(new URL('../infra/universidad/versions.json', import.meta.url), 'utf8'),
  );
  const image = `${versions.powersync.image}:${versions.powersync.tag}@${versions.powersync.digest}`;
  // Credentials only in this process and Docker's private test container environment; never in logs/config files.
  docker(
    'run',
    '-d',
    '--name',
    container,
    '-p',
    '127.0.0.1::8080',
    '--env',
    'PS_SOURCE_URI=' + upstream.href,
    '--env',
    'PS_STORAGE_URI=' + storageUrl.href,
    '--mount',
    `type=bind,source=${directory},target=/config,readonly`,
    image,
    'start',
    '-r',
    'unified',
    '-c',
    '/config/service.yaml',
  );
  createdContainer = true;
  const port = docker('port', container, '8080/tcp').trim().split(':').at(-1);
  const localStorageUrl = new URL(source.href);
  localStorageUrl.pathname = '/' + storageName;
  const storage = new pg.Client({ connectionString: localStorageUrl.href });
  await storage.connect();
  try {
    let verified = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const ready = await fetch(`http://127.0.0.1:${port}/probes/readiness`, {
          signal: AbortSignal.timeout(1000),
        });
        const rows = await storage.query('SELECT count(*) AS n FROM powersync.current_data');
        if (ready.ok && Number(rows.rows[0].n) > 0) {
          verified = true;
          break;
        }
      } catch {
        /* Fresh instance may still be migrating or taking its first snapshot. */
      }
    }
    if (!verified)
      throw new Error(
        'Fresh PowerSync did not become ready with replicated records within 50 seconds.',
      );
    console.log(
      'PASS: new source copy + empty storage + new pinned PowerSync instance became ready and replicated records. No active instance changed.',
    );
  } finally {
    await storage.end();
  }
} finally {
  if (createdContainer) docker('rm', '-f', container);
  // A new source can leave a logical slot on the shared test PostgreSQL; only its own database slots are removed.
  if (createdSource) {
    const slots = await admin.query(
      'SELECT slot_name FROM pg_replication_slots WHERE database=$1',
      [sourceName],
    );
    for (const row of slots.rows)
      await admin.query('SELECT pg_drop_replication_slot($1)', [row.slot_name]);
    await admin.query('DROP DATABASE ' + sourceName);
  }
  if (createdStorage) await admin.query('DROP DATABASE ' + storageName);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
