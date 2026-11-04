import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reports = process.argv.slice(2);
if (!reports.length) throw new Error('Indica las carpetas coverage/<suite> que deben existir.');
const lines = [
  '### Cobertura de pruebas',
  '',
  '| Suite | Sentencias | Ramas | Funciones | Líneas |',
  '| --- | ---: | ---: | ---: | ---: |',
];
for (const report of reports) {
  const folder = resolve(root, report);
  const scope = relative(resolve(root, 'coverage'), folder);
  if (!scope || scope.startsWith('..') || isAbsolute(scope))
    throw new Error(`Carpeta de cobertura fuera del alcance: ${report}`);
  const total = JSON.parse(readFileSync(resolve(folder, 'coverage-summary.json'), 'utf8')).total;
  const lcov = readFileSync(resolve(folder, 'lcov.info'), 'utf8');
  const sources = [...lcov.matchAll(/^SF:(.+)$/gm)].map((match) => match[1].trim());
  if (!sources.length) throw new Error(`LCOV sin archivos fuente: ${report}`);
  for (const source of sources) {
    const sourcePath = resolve(root, source);
    const sourceScope = relative(root, sourcePath);
    if (sourceScope.startsWith('..') || isAbsolute(sourceScope) || !existsSync(sourcePath))
      throw new Error(`Ruta LCOV no resoluble desde el repositorio: ${source}`);
  }
  const cells = ['statements', 'branches', 'functions', 'lines'].map((key) => {
    const metric = total[key];
    if (
      !metric ||
      !Number.isInteger(metric.total) ||
      !Number.isInteger(metric.covered) ||
      metric.covered < 0 ||
      metric.covered > metric.total
    )
      throw new Error(`Resumen inválido (${key}): ${report}`);
    return metric.total === 0
      ? 'Sin elementos'
      : `${metric.pct}% (${metric.covered}/${metric.total})`;
  });
  lines.push(`| ${scope} | ${cells.join(' | ')} |`);
}
lines.push(
  '',
  'Cada fila corresponde a una suite; sus porcentajes no se promedian ni representan aprobación clínica.',
  'Los informes HTML y LCOV se conservan como artefactos del CI.',
  '',
);
const summary = lines.join('\n');
process.stdout.write(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
