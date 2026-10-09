import { computeSha256 } from '../../features/medical-forms/form-legacy-import';
import type { TermDefinitionBundle, TermDefinitionRecord } from './consent-types';
import type { SqlConnection } from './sql';

export function parseAndNormalizeIsoDate(iso: string, fieldName: string): string {
  const timestamp = Date.parse(iso);
  if (isNaN(timestamp)) {
    throw new Error(`Fecha inválida en campo '${fieldName}': '${iso}'.`);
  }
  return new Date(timestamp).toISOString();
}

export async function ingestTermDefinitionsInTransaction(
  tx: SqlConnection,
  bundle: TermDefinitionBundle,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const timestamp = now();

  for (const t of bundle.terminos) {
    // 1. Validar y normalizar fechas a ISO UTC
    const normalizedDesde = parseAndNormalizeIsoDate(t.vigenteDesde, 'vigenteDesde');
    let normalizedHasta: string | null = null;
    if (t.vigenteHasta != null && t.vigenteHasta !== '') {
      normalizedHasta = parseAndNormalizeIsoDate(t.vigenteHasta, 'vigenteHasta');
      if (Date.parse(normalizedHasta) < Date.parse(normalizedDesde)) {
        throw new Error(
          `Vigencia inválida: 'vigenteHasta' (${t.vigenteHasta}) no puede preceder a 'vigenteDesde' (${t.vigenteDesde}).`,
        );
      }
    }

    const computedSha = await computeSha256(t.contenidoMarkdown);

    const existing = await tx.first<TermDefinitionRecord>(
      'SELECT * FROM definicion_terminos_cache WHERE termino_id = ? AND version = ?',
      [t.terminoId, t.version],
    );

    if (existing) {
      if (existing.huella_sha256 !== computedSha) {
        throw new Error(
          `Conflicto de inmutabilidad: la versión '${t.version}' de '${t.terminoId}' ya existe con un contenido distinto.`,
        );
      }
      // Contenido idéntico: idempotente, se conserva sin alteración
      continue;
    }

    const reqInt = typeof t.requerido === 'boolean' ? (t.requerido ? 1 : 0) : (t.requerido ?? 1);

    await tx.run(
      `INSERT INTO definicion_terminos_cache (
         termino_id, version, titulo, contenido_markdown, requerido, vigente_desde, vigente_hasta, huella_sha256, obtenido_en
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.terminoId,
        t.version,
        t.titulo,
        t.contenidoMarkdown,
        reqInt,
        normalizedDesde,
        normalizedHasta,
        computedSha,
        t.obtenidoEn ? parseAndNormalizeIsoDate(t.obtenidoEn, 'obtenidoEn') : timestamp,
      ],
    );
  }
}

export async function ingestTermDefinitions(
  database: SqlConnection,
  bundle: TermDefinitionBundle,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  await database.transaction(async (tx) => {
    await ingestTermDefinitionsInTransaction(tx, bundle, now);
  });
}
