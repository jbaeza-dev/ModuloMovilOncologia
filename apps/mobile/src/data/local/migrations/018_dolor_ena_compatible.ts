import type { SqlConnection } from '../core/sql';
import { BITACORA_MEDICAMENTOS_SQL } from './014_bitacora_medicamentos';

const signColumns = [
  'id',
  'paciente_id',
  'id_ficha_clinica',
  'tratamiento_id',
  'fecha_registro',
  'presion_sistolica',
  'presion_diastolica',
  'pulso',
  'temperatura',
  'saturacion_o2',
  'creado_localmente_en',
  'fecha_subida',
];

/** Old, never released P07 used version 14 for pain instead of medication history.
 * Recognize that precise fork before v15 reads the missing medication table.
 * Do not change its capture, queue, command or pain values. */
export async function prepareLegacyPainFork(db: SqlConnection, version: number): Promise<void> {
  if (version < 14 || version > 17) return;
  const signs = await db.all<{ name: string }>('PRAGMA table_info(signos_vitales)');
  const medication = await db.all<{ name: string }>('PRAGMA table_info(qc_medication_intake_log)');
  const names = signs.map((column) => column.name);
  if (
    signColumns.some((name) => !names.includes(name)) ||
    names.some((name) => ![...signColumns, 'dolor_ena'].includes(name))
  )
    throw new Error('Esquema de signos no reconocido. Conserva la base para su revisión.');
  if (medication.length) return;
  if (version !== 14 || !names.includes('dolor_ena'))
    throw new Error('La versión de la base no coincide con su bitácora. Conserva los datos.');
  await db.transaction(async (tx) => {
    await tx.exec(BITACORA_MEDICAMENTOS_SQL);
    await tx.run(
      'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO NOTHING',
      [
        'schema:legacy-p07-14',
        JSON.stringify({ origin: 'p07-pain-14', repaired: 'medication-14' }),
      ],
    );
  });
}

export async function migratePain18(db: SqlConnection): Promise<void> {
  const info = await db.all<{ name: string }>('PRAGMA table_info(signos_vitales)');
  const names = info.map((column) => column.name);
  if (
    signColumns.some((name) => !names.includes(name)) ||
    names.some((name) => ![...signColumns, 'dolor_ena'].includes(name))
  )
    throw new Error('Esquema de signos no reconocido; no se modificaron sus registros.');
  if (names.includes('dolor_ena')) {
    const invalid = await db.first<{ id: string }>(
      "SELECT id FROM signos_vitales WHERE dolor_ena IS NOT NULL AND (typeof(dolor_ena)<>'integer' OR dolor_ena NOT BETWEEN 0 AND 10) LIMIT 1",
    );
    if (invalid)
      throw new Error('Hay una ENA histórica que requiere revisión; se conserva intacta.');
    return;
  }
  await db.exec(`
    CREATE TABLE signos_vitales_v18 (
      id TEXT PRIMARY KEY NOT NULL, paciente_id TEXT NOT NULL,
      id_ficha_clinica TEXT, tratamiento_id TEXT, fecha_registro TEXT NOT NULL,
      presion_sistolica INTEGER, presion_diastolica INTEGER, pulso INTEGER,
      temperatura REAL, saturacion_o2 INTEGER,
      dolor_ena INTEGER CHECK(dolor_ena IS NULL OR
        (typeof(dolor_ena)='integer' AND dolor_ena BETWEEN 0 AND 10)),
      creado_localmente_en TEXT NOT NULL, fecha_subida TEXT,
      CHECK(temperatura IS NOT NULL OR presion_sistolica IS NOT NULL OR
        presion_diastolica IS NOT NULL OR pulso IS NOT NULL OR
        saturacion_o2 IS NOT NULL OR dolor_ena IS NOT NULL),
      CHECK(temperatura IS NULL OR temperatura>0),
      CHECK(presion_sistolica IS NULL OR presion_sistolica>0),
      CHECK(presion_diastolica IS NULL OR presion_diastolica>0),
      CHECK(pulso IS NULL OR pulso>0),
      CHECK(saturacion_o2 IS NULL OR (saturacion_o2>0 AND saturacion_o2<=100))
    );
    INSERT INTO signos_vitales_v18 (${signColumns.join(',')})
      SELECT ${signColumns.join(',')} FROM signos_vitales;
    DROP TABLE signos_vitales;
    ALTER TABLE signos_vitales_v18 RENAME TO signos_vitales;
    CREATE INDEX idx_signos_paciente_fecha
      ON signos_vitales(paciente_id,fecha_registro DESC,id DESC);
  `);
}
