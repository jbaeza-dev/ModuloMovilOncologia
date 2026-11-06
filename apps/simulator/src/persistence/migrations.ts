import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Database } from '../db.js';
import { transaction } from '../db.js';

export const SIMULATOR_MIGRATIONS = [
  '001-initial-schema.sql',
  '002-universidad-identidad-vinculacion.sql',
  '003-operacion-educativa-idempotencia.sql',
  '004-preparacion.sql',
  '005-selecciones-iniciales.sql',
  '006-podcasts.sql',
  '007-equipo-demostracion.sql',
  '008-medicamentos-plantilla-folfox.sql',
  '009-profesional-activo.sql',
  '010-gestion-evaluacion.sql',
  '011-folfox-medicamentos-activos.sql',
] as const;

export async function migrateSimulator(
  db: Database,
  target: number = SIMULATOR_MIGRATIONS.length,
): Promise<void> {
  if (!Number.isInteger(target) || target < 1 || target > SIMULATOR_MIGRATIONS.length) {
    throw new Error('Versión de migración inválida.');
  }

  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('quimiocare-demo-migration'))");

    // Asegurar estructura de la tabla de control de migraciones
    await client.query(`
      CREATE TABLE IF NOT EXISTS qc_demo_schema_migration (
        version integer PRIMARY KEY,
        checksum text,
        aplicado_en timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE qc_demo_schema_migration ADD COLUMN IF NOT EXISTS checksum text;
    `);

    const applied = await client.query<{ version: number; checksum: string | null }>(
      'SELECT version, checksum FROM qc_demo_schema_migration ORDER BY version',
    );

    if (applied.rows.some((row) => row.version > target)) {
      throw new Error(
        'La base de datos contiene una versión de esquema más reciente que el simulador.',
      );
    }

    for (let index = 0; index < target; index++) {
      const fileName = SIMULATOR_MIGRATIONS[index];
      const sql = await readFile(new URL(`migrations/${fileName}`, import.meta.url), 'utf8');
      const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
      const prior = applied.rows.find((row) => row.version === index + 1);

      if (prior) {
        if (prior.checksum && prior.checksum !== checksum) {
          throw new Error(`La migración aplicada ${fileName} cambió de contenido.`);
        }
        if (!prior.checksum) {
          // Actualizar checksum en registros heredados
          await client.query('UPDATE qc_demo_schema_migration SET checksum=$2 WHERE version=$1', [
            index + 1,
            checksum,
          ]);
        }
        continue;
      }

      await client.query(sql);
      await client.query(
        'INSERT INTO qc_demo_schema_migration(version, checksum) VALUES($1, $2) ON CONFLICT(version) DO UPDATE SET checksum=excluded.checksum',
        [index + 1, checksum],
      );
    }
  });
}
