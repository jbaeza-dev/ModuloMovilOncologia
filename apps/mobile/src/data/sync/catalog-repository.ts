import type { SqlConnection } from '../local/core/sql';
import type { DefinitionSnapshot } from './catalog';

/** The UI consumes complete checkpoint projections, never partially downloaded SDK rows. */
export function createCatalogRepository(connection: SqlConnection) {
  return {
    status: () =>
      connection.first<{ completed_at: string | null; error_code: string | null }>(
        "SELECT completed_at,error_code FROM qc_catalog_status WHERE id='catalog'",
      ),
    async definitions() {
      return (
        await connection.all<{ snapshot_json: string }>(
          'SELECT snapshot_json FROM qc_definition_snapshot WHERE retired=0 ORDER BY id',
        )
      ).map((row) => JSON.parse(row.snapshot_json) as DefinitionSnapshot);
    },
    async definition(id: string) {
      const row = await connection.first<{ snapshot_json: string; retired: number }>(
        'SELECT snapshot_json,retired FROM qc_definition_snapshot WHERE id=?',
        [id],
      );
      return row
        ? {
            snapshot: JSON.parse(row.snapshot_json) as DefinitionSnapshot,
            retired: row.retired === 1,
          }
        : null;
    },
    async education(): Promise<Record<string, unknown>[]> {
      const row = await connection.first<{ value_json: string }>(
        "SELECT value_json FROM qc_storage_control WHERE id='education:checkpoint'",
      );
      return row ? JSON.parse(row.value_json) : [];
    },
  };
}
