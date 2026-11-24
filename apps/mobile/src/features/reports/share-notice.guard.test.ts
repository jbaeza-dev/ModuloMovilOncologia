import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const src = fileURLToPath(new URL('../../', import.meta.url));

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

it('cada lugar que comparte un reporte pide antes la confirmación del paciente', () => {
  const sharers = sources(src)
    .filter((path) => !path.endsWith(join('files', 'report-storage.ts')))
    .map((path) => ({ path: path.slice(src.length), text: readFileSync(path, 'utf8') }))
    .filter(({ text }) => /shareReport(File|Pdf)\(/.test(text));
  expect(sharers.length).toBeGreaterThanOrEqual(3);
  for (const { path, text } of sharers)
    expect(
      {
        path,
        avisos: count(
          text,
          /await confirmIdentifiedShare[(]captureShareContext[(]manager, patientId[)][)]/g,
        ),
      },
      'Falta el aviso de nombre y RUT',
    ).toEqual({ path, avisos: count(text, /shareReport(File|Pdf)\(/g) });
});
