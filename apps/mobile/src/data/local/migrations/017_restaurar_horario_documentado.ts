import type { SqlConnection } from '../core/sql';

/** Repair v16 only where the original deterministic identity proves a scheduled 09:00 intake. */
export async function migration17(db: SqlConnection): Promise<void> {
  const rows = await db.all<{
    id: string;
    paciente_id: string;
    medicamento_id: string;
    fecha_civil: string;
  }>(
    "SELECT id,paciente_id,medicamento_id,fecha_civil FROM qc_medication_intake_log WHERE es_programado=0 AND horario_programado='sin_horario#'||id",
  );
  for (const row of rows) {
    const prefix = `${row.paciente_id}#${row.medicamento_id}#`;
    if (
      !row.id.startsWith(prefix) ||
      !/^\d{4}-\d{2}-\d{2}#09:00$/.test(row.id.slice(prefix.length))
    )
      continue;
    await db.run(
      `UPDATE qc_medication_intake_log SET horario_programado='09:00',es_programado=1
       WHERE id=? AND NOT EXISTS (SELECT 1 FROM qc_medication_intake_log other
       WHERE other.id<>? AND other.paciente_id=? AND other.medicamento_id=? AND other.fecha_civil=? AND other.horario_programado='09:00')`,
      [row.id, row.id, row.paciente_id, row.medicamento_id, row.fecha_civil],
    );
  }
}
