import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  EDUCATION_MAX_BYTES,
  EDUCATION_MAX_COPIES,
  canRestoreEvictedCopies,
} from './education-storage-limits';

const catalog = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../simulator/assets/education/catalog.json', import.meta.url)),
    'utf8',
  ),
) as { items: { type: string; bytes?: number }[] };
const infographics = catalog.items.filter((item) => item.type === 'imagen');

it('el límite permite guardar todas las infografías del catálogo, con margen', () => {
  // Las 42 publicadas el 02-11-2026 suman 80,3 MB: el 77 % del límite, como en el Redmi (R15).
  // El margen de 15 % sigue dejando espacio a una guía nueva del tamaño de la mayor (3,9 MB).
  expect(infographics).toHaveLength(42);
  expect(infographics.every((item) => (item.bytes ?? 0) > 0)).toBe(true);
  const total = infographics.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  expect(infographics.length).toBeLessThanOrEqual(EDUCATION_MAX_COPIES);
  expect(total).toBeLessThanOrEqual(EDUCATION_MAX_BYTES * 0.85);
});

it('solo recupera las expulsadas si todas caben, para no descargar y borrar en ciclo', () => {
  expect(canRestoreEvictedCopies(42, [{ tamanoBytes: 1000 }])).toBe(true);
  expect(canRestoreEvictedCopies(EDUCATION_MAX_COPIES + 1, [])).toBe(false);
  expect(canRestoreEvictedCopies(1, [{ tamanoBytes: EDUCATION_MAX_BYTES + 1 }])).toBe(false);
  expect(canRestoreEvictedCopies(2, [{ tamanoBytes: null }, { tamanoBytes: undefined }])).toBe(
    true,
  );
});
