// An isolated, disposable Linux stack. No existing service, volume or database is reused.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
const id = randomBytes(5).toString('hex'),
  network = 'qc-stack-test-' + id;
const temp = await mkdtemp(join(tmpdir(), 'qc-stack-test-'));
const names = { postgres: network + '-pg', powersync: network + '-sync' };
const image =
  process.env.UNIVERSITY_TEST_SIMULATOR_IMAGE ?? 'localhost/quimiocare-simulator:stack-test-' + id;
const gatewayImage =
  process.env.UNIVERSITY_TEST_GATEWAY_IMAGE ?? 'localhost/quimiocare-gateway:stack-test-' + id;
let mockBin;
let syncSourceDatabase = 'qc_demo',
  syncStorageDatabase = 'qc_powersync';
for (const candidate of [image, gatewayImage])
  if (!/^localhost\/quimiocare-(simulator|gateway):[a-z0-9-]+$/.test(candidate))
    throw Error('Only explicit local test images are accepted');
const run = (args, options = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe', ...options });
const versions = JSON.parse(await readFile('infra/universidad/versions.json', 'utf8'));
const pinned = (key) => versions[key].image + ':' + versions[key].tag + '@' + versions[key].digest;
const password = () => randomBytes(32).toString('hex');
const admin = password(),
  gateway = password(),
  replica = password(),
  storage = password(),
  root = password(),
  token = password();
const uri = (role, secret, db) => 'postgresql://' + role + ':' + secret + '@qc-postgres:5432/' + db;
const common = {
  APP_ENV: 'universidad-demo',
  DATABASE_URL: uri('qc_admin', admin, 'qc_demo'),
  DEMO_CONTROL_KEY: password(),
  AUTH_PROVIDER: 'supabase',
  AUTH_EXPECTED_ISSUER: 'https://synthetic.example/auth/v1',
  AUTH_EXPECTED_AUDIENCE: 'authenticated',
  AUTH_ALLOWED_ALGORITHM: 'ES256',
  AUTH_JWKS_URL: 'https://synthetic.example/auth/v1/.well-known/jwks.json',
  AUTH_PUBLIC_KEY: 'sb_publishable_synthetic_stack_test',
  SIMULATOR_PUBLIC_BASE_URL: 'https://synthetic.example/quimiocare',
  EVALUATION_PATIENT_EMAILS: 'synthetic@example.org',
};
const envArgs = (values) =>
  Object.entries(values).flatMap(([key, value]) => ['--env', key + '=' + value]);
async function wait(probe) {
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      probe();
      return;
    } catch {
      /* isolated service starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error('Disposable stack readiness timed out');
}
try {
  console.log('Building synthetic stack image locally (no registry push).');
  if (!process.env.UNIVERSITY_TEST_SIMULATOR_IMAGE)
    execFileSync(
      'docker',
      ['build', '-f', 'infra/demo/Containerfile.simulator', '-t', image, '.'],
      {
        stdio: 'inherit',
      },
    );
  if (!process.env.UNIVERSITY_TEST_GATEWAY_IMAGE)
    execFileSync(
      'docker',
      ['build', '-f', 'infra/demo/Containerfile.gateway', '-t', gatewayImage, '.'],
      { stdio: 'inherit' },
    );
  run(['network', 'create', network]);
  run([
    'run',
    '--detach',
    '--name',
    names.postgres,
    '--network',
    network,
    '--network-alias',
    'qc-postgres',
    '--tmpfs',
    '/var/lib/postgresql/data',
    ...envArgs({
      POSTGRES_USER: 'postgres',
      POSTGRES_DB: 'postgres',
      POSTGRES_PASSWORD: root,
      QC_ADMIN_PASSWORD: admin,
      QC_GATEWAY_PASSWORD: gateway,
      QC_REPLICA_PASSWORD: replica,
      QC_STORAGE_PASSWORD: storage,
    }),
    '--mount',
    'type=bind,source=' +
      resolve('infra/universidad/postgres/01-consolidated-bootstrap.sh') +
      ',target=/docker-entrypoint-initdb.d/01-bootstrap.sh,readonly',
    '--mount',
    'type=bind,source=' +
      resolve('infra/universidad/postgres/postgresql.conf') +
      ',target=/etc/postgresql/postgresql.conf,readonly',
    pinned('postgres'),
    'postgres',
    '-c',
    'config_file=/etc/postgresql/postgresql.conf',
  ]);
  await wait(() =>
    run(['exec', names.postgres, 'psql', '-U', 'postgres', '-d', 'qc_demo', '-c', 'SELECT 1']),
  );
  const node = (values, command) =>
    run(['run', '--rm', '--network', network, ...envArgs(values), image, ...command]);
  node(common, ['node', 'apps/simulator/dist/migrate.js']);
  node(common, ['node', 'apps/simulator/dist/seed.js']);
  node(common, ['node', 'apps/simulator/dist/provision-evaluation.js']);
  run([
    'run',
    '--rm',
    '--network',
    network,
    ...envArgs({
      ...common,
      GATEWAY_DATABASE_URL: uri('qc_gateway', gateway, 'qc_gateway_demo'),
      GATEWAY_CURSOR_KEY: password(),
      CLINICAL_API_URL: 'http://qc-clinical:3002',
      AI_API_URL: 'http://qc-ai:3003',
      PUSH_PROVIDER: 'expo',
    }),
    gatewayImage,
    'node',
    'apps/gateway/dist/migrate.js',
  ]);
  const counts = run([
    'exec',
    names.postgres,
    'psql',
    '-XAt',
    '-U',
    'postgres',
    '-d',
    'qc_demo',
    '-c',
    "SELECT (SELECT count(*) FROM qc_demo_invitacion_paciente WHERE email='synthetic@example.org'),(SELECT count(*) FROM qc_demo_operador WHERE email='synthetic@example.org')",
  ]);
  if (counts.trim() !== '1|0')
    throw Error('Patient provision unexpectedly granted operator access');
  run(
    [
      'exec',
      '-i',
      names.postgres,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'qc_demo',
    ],
    { input: await readFile('infra/universidad/postgres/02-setup-replication.sql') },
  );
  node({ ...common, EDUCATION_MEDIA_ROOT: '/tmp/no-published-images' }, [
    'node',
    'apps/simulator/scripts/verify-education.mjs',
  ]);
  if (process.platform === 'linux') {
    // Real dumps and pg_restore in the new stack; only systemd is stubbed.
    // A test must never stop a service on the runner host.
    mockBin = await mkdtemp('/var/tmp/qc-stack-bin-');
    const bin = mockBin,
      media = join(temp, 'media'),
      backups = join(temp, 'backups');
    await mkdir(join(media, 'educacion'), { recursive: true });
    const materialId = randomUUID(),
      revision = randomUUID();
    await mkdir(join(media, 'educacion', materialId));
    await writeFile(
      join(media, 'educacion', materialId, revision + '.png'),
      await readFile('packages/contracts/fixtures/imagen-prueba.png'),
    );
    run([
      'exec',
      names.postgres,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'qc_demo',
      '-c',
      `INSERT INTO contenido_educativo(id,profesional_id,titulo,descripcion,tipo,url,categoria,activo,fecha_creacion,carpeta_id,archivo_mime,archivo_tamano_bytes,archivo_revision,archivo_sha256) SELECT '${materialId}',profesional_id,'Imagen sintetica de recuperacion',descripcion,tipo,'https://synthetic.example/quimiocare/archivos/educacion/${materialId}/${revision}.png',categoria,true,fecha_creacion,carpeta_id,archivo_mime,archivo_tamano_bytes,'${revision}',archivo_sha256 FROM contenido_educativo WHERE id='8384c56c-0b01-5629-9108-0ec27217646e'`,
    ]);
    await writeFile(
      join(bin, 'systemctl'),
      '#!/usr/bin/env bash\nif [[ "$2" == is-active ]]; then exit 3; fi\nexit 0\n',
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      PATH: bin + ':' + process.env.PATH,
      CONTAINER_ENGINE: 'docker',
      DATABASE_CONTAINER: names.postgres,
      DATABASE_USER: 'postgres',
      CLINICAL_DATABASE: 'qc_demo',
      GATEWAY_DATABASE: 'qc_gateway_demo',
      MEDIA_ROOT: media,
      BACKUP_ROOT: backups,
    };
    execFileSync('bash', ['infra/universidad/scripts/backup.sh'], { env, stdio: 'pipe' });
    const backup = join(backups, (await readdir(backups))[0]);
    const restoreEnv = {
      ...env,
      BACKUP_DIR: backup,
      NEW_CLINICAL_DATABASE: 'qc_restore_clinical_test',
      NEW_GATEWAY_DATABASE: 'qc_restore_gateway_test',
      NEW_SYNC_DATABASE: 'qc_restore_sync_test',
      NEW_MEDIA_ROOT: join(temp, 'restored'),
      SIMULATOR_IMAGE: image,
      DATABASE_NETWORK: network,
      RESTORE_DATABASE_URL: uri('postgres', root, 'qc_restore_clinical_test'),
    };
    execFileSync('bash', ['infra/universidad/scripts/restore.sh'], {
      env: restoreEnv,
      stdio: 'pipe',
    });
    await writeFile(
      join(temp, 'restored', 'educacion', materialId, revision + '.png'),
      'corrupt test image',
    );
    let corruptRejected = false;
    try {
      run([
        'run',
        '--rm',
        '--network',
        network,
        '--user',
        process.getuid() + ':' + process.getgid(),
        ...envArgs({
          DATABASE_URL: restoreEnv.RESTORE_DATABASE_URL,
          EDUCATION_MEDIA_ROOT: '/restore/educacion',
        }),
        '--mount',
        'type=bind,source=' + restoreEnv.NEW_MEDIA_ROOT + ',target=/restore,readonly',
        image,
        'node',
        'apps/simulator/scripts/verify-education.mjs',
      ]);
    } catch {
      corruptRejected = true;
    }
    if (!corruptRejected) throw Error('Corrupt restored bytes must fail verification');
    await writeFile(
      join(temp, 'restored', 'educacion', materialId, revision + '.png'),
      await readFile('packages/contracts/fixtures/imagen-prueba.png'),
    );
    let refused = false;
    try {
      execFileSync('bash', ['infra/universidad/scripts/restore.sh'], {
        env: { ...restoreEnv, NEW_MEDIA_ROOT: join(temp, 'existing-database-rejected') },
        stdio: 'pipe',
      });
    } catch {
      refused = true;
    }
    if (!refused) throw Error('Restore must refuse existing databases');
    run([
      'exec',
      names.postgres,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-c',
      'ALTER DATABASE qc_restore_sync_test OWNER TO qc_storage',
    ]);
    syncSourceDatabase = restoreEnv.NEW_CLINICAL_DATABASE;
    syncStorageDatabase = restoreEnv.NEW_SYNC_DATABASE;
    console.log(
      'PASS: Linux custom dumps, new-target pg_restore, file verification and existing-target refusal.',
    );
  }
  await writeFile(
    join(temp, 'service.yaml'),
    await readFile('infra/universidad/powersync/service.yaml'),
  );
  await writeFile(
    join(temp, 'sync-config.yaml'),
    await readFile('infra/universidad/powersync/sync-config.yaml'),
  );
  run([
    'run',
    '--detach',
    '--name',
    names.powersync,
    '--network',
    network,
    '--tmpfs',
    '/var/lib/powersync',
    ...envArgs({
      PS_SOURCE_URI: uri('qc_replica', replica, syncSourceDatabase) + '?sslmode=disable',
      PS_STORAGE_URI: uri('qc_storage', storage, syncStorageDatabase) + '?sslmode=disable',
      PS_ADMIN_TOKEN: token,
      PS_JWKS_URI: 'https://synthetic.example/auth/v1/.well-known/jwks.json',
    }),
    '--mount',
    'type=bind,source=' + join(temp, 'service.yaml') + ',target=/config/service.yaml,readonly',
    '--mount',
    'type=bind,source=' +
      join(temp, 'sync-config.yaml') +
      ',target=/config/sync-config.yaml,readonly',
    pinned('powersync'),
    'start',
    '-r',
    'unified',
    '-c',
    '/config/service.yaml',
  ]);
  const ready = await readFile('infra/universidad/scripts/powersync-ready.mjs', 'utf8');
  await wait(() =>
    run(['exec', '-i', names.powersync, 'node', '--input-type=module'], { input: ready }),
  );
  console.log(
    'PASS: fresh PostgreSQL bootstrap, non-superuser clinical migrations/seed, patient-only invitation, education references and initial PowerSync replication with separate source/storage roles.',
  );
} finally {
  for (const name of Object.values(names))
    try {
      run(['rm', '--force', name]);
    } catch {
      /* test resource not created */
    }
  try {
    run(['network', 'rm', network]);
  } catch {
    /* no network created */
  }
  await rm(temp, { recursive: true, force: true });
  if (mockBin) await rm(mockBin, { recursive: true, force: true });
  // Keep the local test image for inspection; never prune other work or deployment images.
}
