import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { packageRelease } from './package-university-release.mjs';

test('APK university configuration requires real public inputs and produces institutional prefixes', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'qc-apk-config-test-'));
  try {
    const path = join(temp, 'github-env');
    const env = {
      ...process.env,
      GITHUB_ENV: path,
      EXPO_PUBLIC_APP_ENV: 'universidad-demo',
      EXPO_PUBLIC_P07_SYNTHETIC_REVIEW: 'true',
      QC_PUBLIC_ORIGIN: 'https://example.org',
      QC_AUTH_ISSUER: 'https://synthetic.supabase.co/auth/v1',
      QC_AUTH_PUBLIC_KEY: 'sb_publishable_synthetic_public_test_key',
    };
    const run = (overrides = {}) =>
      execFileSync(process.execPath, ['scripts/configure-apk.mjs'], {
        env: { ...env, ...overrides },
        stdio: 'pipe',
      });
    run();
    const saved = await readFile(path, 'utf8');
    assert.match(saved, /EXPO_PUBLIC_POWERSYNC_URL=https:\/\/example.org\/quimiocare-backend\n/);
    const syncEndpoint = saved.match(/^EXPO_PUBLIC_POWERSYNC_URL=(.+)$/m)[1];
    // PowerSync concatenates its stream path onto the configured endpoint.
    assert.equal(
      syncEndpoint + '/sync/stream',
      'https://example.org/quimiocare-backend/sync/stream',
    );
    assert.match(saved, /EXPO_PUBLIC_DEMO_MODE=false/);
    assert.match(saved, /EXPO_PUBLIC_P07_SYNTHETIC_REVIEW=true/);
    for (const overrides of [
      { EXPO_PUBLIC_APP_ENV: 'production' },
      { EXPO_PUBLIC_P07_SYNTHETIC_REVIEW: 'not-a-boolean' },
      { QC_PUBLIC_ORIGIN: '' },
      { QC_PUBLIC_ORIGIN: 'http://example.org' },
      { QC_PUBLIC_ORIGIN: 'https://:synthetic@example.org' },
      { QC_AUTH_PUBLIC_KEY: 'sb_secret_' + 'synthetic_private_key' },
    ])
      assert.throws(() => run(overrides));
    assert.equal(await readFile(path, 'utf8'), saved, 'Rejected configuration must not be written');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('academic APKs include labelled triage review by default and respect explicit opt-out', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'qc-triage-config-test-'));
  try {
    for (const profile of ['universidad-demo']) {
      for (const flag of [undefined, 'false']) {
        const output = join(temp, profile + '-' + (flag ?? 'default'));
        const env = {
          ...process.env,
          GITHUB_ENV: output,
          EXPO_PUBLIC_APP_ENV: profile,
          QC_PUBLIC_ORIGIN: 'https://example.org',
          QC_AUTH_ISSUER: 'https://synthetic.supabase.co/auth/v1',
          QC_AUTH_PUBLIC_KEY: 'sb_publishable_synthetic_public_test_key',
        };
        delete env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW;
        if (flag !== undefined) env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = flag;
        execFileSync(process.execPath, ['scripts/configure-apk.mjs'], { env, stdio: 'pipe' });
        const saved = await readFile(output, 'utf8');
        assert.match(
          saved,
          new RegExp('EXPO_PUBLIC_P07_SYNTHETIC_REVIEW=' + (flag ?? 'true') + '\\n'),
        );
        assert.match(saved, /EXPO_PUBLIC_DEMO_MODE=false\n/);
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('immutable release passes Python verification; tampering and wrong publisher fail', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'qc-release-test-'));
  try {
    const output = join(temp, 'release');
    const jwksSnapshot = join(temp, 'snapshot.json');
    await writeFile(jwksSnapshot, '{"synthetic":"snapshot-for-manifest-test"}');
    const manifest = await packageRelease({
      output,
      jwksSnapshot,
      revision: 'a'.repeat(40),
      sequence: 2,
      runId: 15,
      attempt: 1,
      namespace: 'ghcr.io/test',
      digests: { simulator: 'sha256:' + 'b'.repeat(64), gateway: 'sha256:' + 'c'.repeat(64) },
    });
    assert.equal(manifest.schema, 2);
    assert.ok(manifest.files['infra/universidad/postgres/02-setup-replication.sql']);
    assert.ok(manifest.files['infra/universidad/jwks-snapshot.json']);
    assert.ok(manifest.files['infra/universidad/systemd/qc-jwks-expiry.timer']);
    assert.equal(
      await readFile(join(output, 'infra/universidad/postgres/02-setup-replication.sql'), 'utf8'),
      await readFile('infra/universidad/postgres/02-setup-replication.sql', 'utf8'),
    );
    assert.ok(!Object.keys(manifest.files).some((x) => /(\.env$|\.dump$|local_storage)/.test(x)));
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const verify = (namespace = 'ghcr.io/test') =>
      execFileSync(
        python,
        ['infra/universidad/scripts/release.py', output, '--namespace', namespace],
        { encoding: 'utf8', stdio: 'pipe' },
      );
    assert.match(verify(), /verified/);
    execFileSync(python, [
      'infra/universidad/scripts/release.py',
      output,
      '--namespace',
      'ghcr.io/test',
      '--render',
      join(temp, 'units'),
    ]);
    assert.ok((await readdir(join(temp, 'units'))).includes('qc-powersync.container'));
    assert.throws(() => verify('ghcr.io/other'));
    const savedSnapshot = await readFile(join(output, 'infra/universidad/jwks-snapshot.json'));
    await writeFile(join(output, 'infra/universidad/jwks-snapshot.json'), '{}');
    assert.throws(() => verify(), 'A modified snapshot must invalidate the release');
    await writeFile(join(output, 'infra/universidad/jwks-snapshot.json'), savedSnapshot);
    await writeFile(join(output, 'infra/universidad/scripts/deploy.sh'), 'tampered\n');
    assert.throws(() => verify());
    assert.equal(
      JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')).revision,
      'a'.repeat(40),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
