import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function packageRelease({
  output,
  revision,
  sequence,
  runId,
  attempt,
  namespace,
  digests,
}) {
  if (
    !/^[a-f0-9]{40}$/.test(revision) ||
    ![sequence, runId, attempt].every((v) => Number.isSafeInteger(v) && v > 0) ||
    !/^ghcr\.io\/[a-z0-9_.-]+$/.test(namespace)
  )
    throw new Error('Invalid CI release identity.');
  const root = resolve(output);
  await mkdir(root, { recursive: false });
  const manifest = {
    schema: 2,
    release_id: revision + '-' + runId + '-' + attempt,
    revision,
    sequence,
    platform: 'linux/amd64',
    images: {},
    files: {},
  };
  for (const name of ['simulator', 'gateway']) {
    if (!/^sha256:[a-f0-9]{64}$/.test(digests[name]))
      throw new Error('Missing verified digest: ' + name);
    manifest.images[name] = { reference: namespace + '/quimiocare-' + name + '@' + digests[name] };
  }
  // Explicit source allowlist. Private env, dumps, build products and local artifacts never enter a release.
  async function copy(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Release source symlink rejected.');
      if (entry.isDirectory()) {
        if (['quadlet', 'scripts', 'postgres', 'proxy', 'powersync'].includes(entry.name))
          await copy(path);
        continue;
      }
      if (!/\.(sh|sql|py|mjs|container|volume|network|conf|yaml|json|md|example)$/.test(entry.name))
        continue;
      const rel = relative(process.cwd(), path).replaceAll('\\', '/');
      if (entry.name.startsWith('.') || rel.includes('__pycache__')) continue;
      const dest = join(root, rel);
      await mkdir(resolve(dest, '..'), { recursive: true });
      await copyFile(path, dest);
      manifest.files[rel] = createHash('sha256')
        .update(await readFile(dest))
        .digest('hex');
    }
  }
  await copy(resolve('infra/universidad'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const checksums = [
    ...Object.entries(manifest.files).map(([file, sha]) => sha + '  ' + file),
    createHash('sha256')
      .update(await readFile(join(root, 'manifest.json')))
      .digest('hex') + '  manifest.json',
  ];
  await writeFile(join(root, 'SHA256SUMS'), checksums.join('\n') + '\n');
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const revision = process.env.GITHUB_SHA;
  const output = process.env.RELEASE_OUTPUT;
  if (!output) throw new Error('Explicit RELEASE_OUTPUT required.');
  const digests = {};
  for (const name of ['simulator', 'gateway']) {
    const record = JSON.parse(await readFile('build/digests/' + name + '.json', 'utf8'));
    if (record.revision !== revision)
      throw new Error('Image revision differs from the CI source: ' + name);
    digests[name] = record.digest;
  }
  const manifest = await packageRelease({
    output,
    revision,
    sequence: Number(process.env.GITHUB_RUN_NUMBER),
    runId: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    namespace: process.env.IMAGE_NAMESPACE,
    digests,
  });
  execFileSync('tar', ['-czf', resolve(output) + '.tar.gz', '-C', resolve(output), '.'], {
    stdio: 'inherit',
  });
  console.log(
    'Packaged ' + manifest.release_id + ' without environment secrets or application archives.',
  );
}
