import { computeSha256 } from '../../features/medical-forms/form-legacy-import';
import type { TermDefinitionBundle, TermDefinitionRecord } from './consent-types';
import type { SqlConnection } from './sql';

export async function ingestTermDefinitionsInTransaction(
  tx: SqlConnection,
  bundle: TermDefinitionBundle,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const timestamp = now();

  for (const t of bundle.terminos) {
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
        t.vigenteDesde,
        t.vigenteHasta ?? null,
        computedSha,
        t.obtenidoEn ?? timestamp,
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
