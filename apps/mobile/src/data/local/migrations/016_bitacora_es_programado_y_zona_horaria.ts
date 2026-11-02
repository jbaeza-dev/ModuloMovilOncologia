import type { SqlConnection } from '../core/sql';
import { getCivilPartsInTimeZone } from '../../../services/reminders/reminder-status';

export const BITACORA_ZONA_HORARIA_VERSION = 16;
export const BITACORA_ZONA_HORARIA_SQL = `
-- Migración 16: Preservación de esquema v15, columna es_programado y calibración civil America/Santiago
`;

export async function runMigration16(connection: SqlConnection): Promise<void> {
  // 1. Agregar la columna es_programado si no existe en la tabla
  const tableInfo = await connection.all<{ name: string }>(
    'PRAGMA table_info(qc_medication_intake_log)',
  );
  const columnNames = tableInfo.map((c) => c.name);
  if (!columnNames.includes('es_programado')) {
    await connection.exec(
      'ALTER TABLE qc_medication_intake_log ADD COLUMN es_programado INTEGER NOT NULL DEFAULT 1',
    );
  }

  // 2. Leer todos los registros existentes para calibrar fecha_civil con America/Santiago
  // y normalizar registros no programados heredados de v15
  const rows = await connection.all<{
    id: string;
    paciente_id: string;
    medicamento_id: string;
    fecha_hora: string;
    horario_programado: string;
    fecha_civil: string;
    estado: 'taken' | 'omitted';
    notas: string | null;
    registrado_en: string;
  }>(
    'SELECT id, paciente_id, medicamento_id, fecha_hora, horario_programado, fecha_civil, estado, notas, registrado_en FROM qc_medication_intake_log',
  );

  for (const row of rows) {
    // Cálculo preciso de fecha civil en America/Santiago (independiente de la zona horaria del dispositivo o SQLite)
    const civilDate = getCivilPartsInTimeZone(row.fecha_hora, 'America/Santiago').civilDate;

    // Diferenciar registros que no corresponden a un recordatorio programado
    const isUnprogrammed =
      row.horario_programado.startsWith('sin_horario') || row.horario_programado === '09:00';
    const esProgramado = isUnprogrammed ? 0 : 1;

    // Si tenía '09:00' asignado por fallback de la migración 15 anterior, convertir a 'sin_horario#' || id
    const newHorario =
      row.horario_programado === '09:00' ? `sin_horario#${row.id}` : row.horario_programado;

    await connection.run(
      `UPDATE qc_medication_intake_log SET
         fecha_civil = ?,
         horario_programado = ?,
         es_programado = ?
       WHERE id = ?`,
      [civilDate, newHorario, esProgramado, row.id],
    );

    // Asegurar evento de auditoría inicial si no fue creado en v15
    const existingEvent = await connection.first<{ id: string }>(
      'SELECT id FROM qc_medication_intake_events WHERE toma_id = ?',
      [row.id],
    );
    if (!existingEvent) {
      await connection.run(
        `INSERT INTO qc_medication_intake_events
         (id, toma_id, paciente_id, medicamento_id, tipo_evento, estado_nuevo, estado_anterior, notas, creado_en)
         VALUES (?, ?, ?, ?, 'registro_inicial', ?, NULL, ?, ?)`,
        [
          `evt-${row.id}`,
          row.id,
          row.paciente_id,
          row.medicamento_id,
          row.estado,
          row.notas,
          row.registrado_en,
        ],
      );
    }
  }
}
