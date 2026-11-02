import type { SqlConnection, SqlValue } from '../local/core/sql';
import { canonical, type ClinicalScope } from './clinical-command';
import { transferLegacyCommand } from './legacy-command';

export const migrationPhases = [
  'preparar',
  'detener_emisor',
  'copiar',
  'verificar',
  'propiedad_sdk',
  'habilitar',
] as const;
export type MigrationPhase = (typeof migrationPhases)[number];
export interface LegacyInventory {
  version: number;
  tables: { name: string; columns: string[]; rows: Record<string, SqlValue>[] }[];
}
const identifier = (value: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    throw new Error('Identificador SQLite no permitido.');
  return '"' + value + '"';
};

/** Inventory is private. Shared evidence contains counts/digests, never clinical rows. */
export async function inventoryLegacy(
  source: SqlConnection,
  scope: ClinicalScope | null,
): Promise<LegacyInventory> {
  const version =
    (await source.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  const names = await source.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'qc_%' AND name NOT LIKE 'ps_%' AND name NOT IN ('formulario','pregunta','contenido_educativo') ORDER BY name",
  );
  const tables: LegacyInventory['tables'] = [];
  for (const { name } of names) {
    const info = await source.all<{ name: string; pk: number }>(
      'PRAGMA table_info(' + identifier(name) + ')',
    );
    const columns = info.map((c) => c.name);
    const order = info
      .filter((c) => c.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => identifier(c.name));
    const owned = columns.includes('paciente_id');
    const shared = [
      'formulario_cache',
      'pregunta_cache',
      'profesional_medico_cache',
      'tipo_notificacion_local',
      'definicion_terminos_cache',
    ].includes(name);
    if (!owned && !shared) throw new Error('Tabla sin política de propietario: ' + name);
    const filtered = owned && scope !== null;
    const rows = await source.all<Record<string, SqlValue>>(
      'SELECT * FROM ' +
        identifier(name) +
        (filtered ? ' WHERE paciente_id = ?' : '') +
        ' ORDER BY ' +
        (order.length ? order.join(',') : columns.map(identifier).join(',')),
      filtered ? [scope.localPatientId] : [],
    );
    tables.push({ name, columns, rows });
  }
  return { version, tables };
}

export async function copyLegacyInventory(inventory: LegacyInventory, target: SqlConnection) {
  const ordered = [...inventory.tables].sort((a, b) => {
    const priority = (n: string) => (n === 'paciente_cache' ? 0 : n === 'formulario_cache' ? 1 : 2);
    return priority(a.name) - priority(b.name) || a.name.localeCompare(b.name);
  });
  await target.transaction(async (tx) => {
    // Constraints are checked at commit, allowing the historical FK graph to be copied intact.
    await tx.exec('PRAGMA defer_foreign_keys = ON');
    for (const table of ordered) {
      const names = table.columns.map(identifier).join(',');
      const placeholders = table.columns.map(() => '?').join(',');
      for (const row of table.rows)
        await tx.run(
          'INSERT OR IGNORE INTO ' +
            identifier(table.name) +
            '(' +
            names +
            ') VALUES (' +
            placeholders +
            ')',
          table.columns.map((c) => row[c]),
        );
    }
  });
}

export async function verifyLegacyInventory(inventory: LegacyInventory, target: SqlConnection) {
  for (const table of inventory.tables) {
    // Compare the complete original snapshot; do not silently accept an ID collision.
    const pk = await target.all<{ name: string; pk: number }>(
      'PRAGMA table_info(' + identifier(table.name) + ')',
    );
    const primary = pk
      .filter((c) => c.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    if (!primary.length && table.rows.length)
      throw new Error('Falta clave de verificación de migración.');
    for (const row of table.rows) {
      const copy = await target.first<Record<string, SqlValue>>(
        'SELECT * FROM ' +
          identifier(table.name) +
          ' WHERE ' +
          primary.map((c) => identifier(c) + ' = ?').join(' AND '),
        primary.map((c) => row[c]),
      );
      if (
        !copy ||
        canonical(Object.fromEntries(table.columns.map((c) => [c, copy[c]]))) !== canonical(row)
      )
        throw new Error('Verificación de migración fallida en ' + table.name);
    }
  }
}

export async function migrateOwner(
  source: SqlConnection,
  target: SqlConnection,
  scope: ClinicalScope,
  checkpoint: (phase: MigrationPhase) => Promise<void> = async () => undefined,
) {
  const key = 'migration:' + scope.environment + ':' + scope.owner;
  const state = await target.first<{ value_json: string }>(
    'SELECT value_json FROM qc_storage_control WHERE id = ?',
    [key],
  );
  if (state && JSON.parse(state.value_json).phase === 'habilitar') return;
  const inventory = await inventoryLegacy(source, scope);
  const savePhase = async (phase: MigrationPhase) => {
    await target.run(
      'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
      [
        key,
        canonical({
          phase,
          owner: scope.owner,
          environment: scope.environment,
          sourceVersion: inventory.version,
        }),
      ],
    );
    await checkpoint(phase);
  };
  await savePhase('preparar');
  if (![11, 12, 13, 14, 15, 16, 17].includes(inventory.version))
    throw new Error(
      'El origen debe estar cercado por una migración admitida (11, 12, 13, 14, 15, 16 o 17) antes de transferir.',
    );
  await savePhase('detener_emisor');
  await copyLegacyInventory(inventory, target);
  await savePhase('copiar');
  await verifyLegacyInventory(inventory, target);
  await savePhase('verificar');
  const queues = await target.all<{ id: string }>(
    'SELECT id FROM cola_envio WHERE paciente_id = ? ORDER BY creado_en, id',
    [scope.localPatientId],
  );
  for (const row of queues)
    await target.transaction(async (tx) => {
      await transferLegacyCommand(tx, scope, row.id);
    });
  await savePhase('propiedad_sdk');
  await savePhase('habilitar');
}
