import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./configure-apk.mjs', import.meta.url));
const university = {
  QC_PUBLIC_ORIGIN: 'https://quimiocare.example.cl',
  QC_AUTH_ISSUER: 'https://synthetic-project.supabase.co/auth/v1',
  QC_AUTH_PUBLIC_KEY: 'sb_publishable_synthetic_test_only',
};

function run(env) {
  const dir = mkdtempSync(join(tmpdir(), 'qc-configure-apk-'));
  const output = join(dir, 'github-env');
  try {
    const result = spawnSync(process.execPath, [script], {
      env: { PATH: process.env.PATH, GITHUB_ENV: output, ...env },
      encoding: 'utf8',
    });
    let written = '';
    try {
      written = readFileSync(output, 'utf8');
    } catch {
      /* El script no escribió nada. */
    }
    return { status: result.status, stderr: result.stderr, written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('rechaza el perfil demo: el APK se compila solo como universidad-demo', () => {
  const result = run({ EXPO_PUBLIC_APP_ENV: 'demo', ...university });
  assert.notEqual(result.status, 0);
  assert.equal(result.written, '');
});

test('rechaza un perfil ausente o desconocido', () => {
  assert.notEqual(run({}).status, 0);
  assert.notEqual(run({ EXPO_PUBLIC_APP_ENV: 'production', ...university }).status, 0);
});

test('universidad-demo escribe los endpoints HTTPS y desactiva el modo demo', () => {
  const result = run({ EXPO_PUBLIC_APP_ENV: 'universidad-demo', ...university });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.written, /^EXPO_PUBLIC_DEMO_MODE=false$/m);
  assert.match(
    result.written,
    /^EXPO_PUBLIC_CLINICAL_URL=https:\/\/quimiocare\.example\.cl\/quimiocare$/m,
  );
  assert.match(
    result.written,
    /^EXPO_PUBLIC_POWERSYNC_URL=https:\/\/quimiocare\.example\.cl\/quimiocare-backend$/m,
  );
});

test('universidad-demo exige las variables públicas del servidor', () => {
  const result = run({ EXPO_PUBLIC_APP_ENV: 'universidad-demo' });
  assert.notEqual(result.status, 0);
  assert.equal(result.written, '');
});
