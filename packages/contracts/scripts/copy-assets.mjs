import { cpSync, mkdirSync } from 'node:fs';

// tsc copies referenced JSON; binary fixtures and provenance must accompany the compiled module.
const root = new URL('../', import.meta.url);
mkdirSync(new URL('dist/', root), { recursive: true });
for (const dir of ['fixtures', 'specs', 'schemas']) {
  cpSync(new URL(`${dir}/`, root), new URL(`dist/${dir}/`, root), { recursive: true });
}
