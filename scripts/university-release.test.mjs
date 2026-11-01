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
    for (const overrides of [
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

test('immutable release passes Python verification; tampering and wrong publisher fail', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'qc-release-test-'));
  try {
    const output = join(temp, 'release');
    const manifest = await packageRelease({
      output,
      revision: 'a'.repeat(40),
      sequence: 2,
      runId: 15,
      attempt: 1,
      namespace: 'ghcr.io/test',
      digests: { simulator: 'sha256:' + 'b'.repeat(64), gateway: 'sha256:' + 'c'.repeat(64) },
    });
    assert.equal(manifest.schema, 2);
    assert.ok(manifest.files['infra/universidad/postgres/02-setup-replication.sql']);
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
