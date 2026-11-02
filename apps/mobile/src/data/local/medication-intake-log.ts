import type { SqlConnection } from './core/sql';

export interface MedicationIntakeLogEntry {
  id: string;
  paciente_id: string;
  medicamento_id: string;
  medicamento_nombre: string;
  dosis?: string | null;
  fecha_civil: string; // YYYY-MM-DD
  horario_programado: string; // Identificador del horario programado (ej: '08:00', '20:00', o 'sin_horario#...')
  es_programado?: number; // 1 para tomas con recordatorio programado, 0 para tomas sin horario programado
  fecha_hora: string; // ISO 8601
  estado: 'taken' | 'omitted';
  notas?: string | null;
  registrado_en: string; // ISO 8601
  rectificado_en?: string | null; // ISO 8601 cuando se corrige una toma previa
  estado_anterior?: 'taken' | 'omitted' | null;
  notas_anteriores?: string | null;
}

export interface MedicationIntakeEvent {
  id: string;
  toma_id: string;
  paciente_id: string;
  medicamento_id: string;
  tipo_evento: 'registro_inicial' | 'rectificacion';
  estado_nuevo: 'taken' | 'omitted';
  estado_anterior: 'taken' | 'omitted' | null;
  notas: string | null;
  creado_en: string;
}

export function generateIntakeLogId(
  pacienteId: string,
  medicamentoId: string,
  fechaCivil: string,
  horarioProgramado = 'default',
): string {
  return `${pacienteId}#${medicamentoId}#${fechaCivil}#${horarioProgramado}`;
}

function generateEventId(tomaId: string, timestamp: string): string {
  const salt = Math.random().toString(36).substring(2, 8);
  return `evt-${tomaId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${timestamp.replace(/[^0-9]/g, '').slice(0, 14)}-${salt}`;
}

export async function logMedicationIntake(
  connection: SqlConnection,
  entry: MedicationIntakeLogEntry,
): Promise<void> {
  await connection.transaction(async (tx) => {
    const existing = await tx.first<{
      id: string;
      estado: 'taken' | 'omitted';
      notas: string | null;
    }>(
      `SELECT id, estado, notas FROM qc_medication_intake_log
       WHERE paciente_id = ? AND medicamento_id = ? AND fecha_civil = ? AND horario_programado = ?`,
      [entry.paciente_id, entry.medicamento_id, entry.fecha_civil, entry.horario_programado],
    );

    if (existing) {
      // Rectificación: conservar estado y notas previas, y registrar auditoría inmutable
      await tx.run(
        `UPDATE qc_medication_intake_log SET
           estado = ?,
           fecha_hora = ?,
           notas = ?,
           rectificado_en = ?,
           estado_anterior = ?,
           notas_anteriores = ?
         WHERE id = ?`,
        [
          entry.estado,
          entry.fecha_hora,
          entry.notas ?? null,
          entry.registrado_en,
          existing.estado,
          existing.notas,
          existing.id,
        ],
      );

      const eventId = generateEventId(existing.id, entry.registrado_en);
      await tx.run(
        `INSERT INTO qc_medication_intake_events
         (id, toma_id, paciente_id, medicamento_id, tipo_evento, estado_nuevo, estado_anterior, notas, creado_en)
         VALUES (?, ?, ?, ?, 'rectificacion', ?, ?, ?, ?)`,
        [
          eventId,
          existing.id,
          entry.paciente_id,
          entry.medicamento_id,
          entry.estado,
          existing.estado,
          entry.notas ?? null,
          entry.registrado_en,
        ],
      );
    } else {
      // Registro inicial de la toma
      const esProgramado =
        entry.es_programado ?? (entry.horario_programado.startsWith('sin_horario') ? 0 : 1);

      await tx.run(
        `INSERT INTO qc_medication_intake_log
         (id, paciente_id, medicamento_id, medicamento_nombre, dosis, fecha_civil, horario_programado, es_programado, fecha_hora, estado, notas, registrado_en, rectificado_en, estado_anterior, notas_anteriores)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        [
          entry.id,
          entry.paciente_id,
          entry.medicamento_id,
          entry.medicamento_nombre,
          entry.dosis ?? null,
          entry.fecha_civil,
          entry.horario_programado,
          esProgramado,
          entry.fecha_hora,
          entry.estado,
          entry.notas ?? null,
          entry.registrado_en,
        ],
      );

      const eventId = generateEventId(entry.id, entry.registrado_en);
      await tx.run(
        `INSERT INTO qc_medication_intake_events
         (id, toma_id, paciente_id, medicamento_id, tipo_evento, estado_nuevo, estado_anterior, notas, creado_en)
         VALUES (?, ?, ?, ?, 'registro_inicial', ?, NULL, ?, ?)`,
        [
          eventId,
          entry.id,
          entry.paciente_id,
          entry.medicamento_id,
          entry.estado,
          entry.notas ?? null,
          entry.registrado_en,
        ],
      );
    }
  });
}

export async function getRecentMedicationIntakes(
  connection: SqlConnection,
  pacienteId: string,
  limit = 20,
): Promise<MedicationIntakeLogEntry[]> {
  return connection.all<MedicationIntakeLogEntry>(
    `SELECT id, paciente_id, medicamento_id, medicamento_nombre, dosis, fecha_civil, horario_programado, es_programado, fecha_hora, estado, notas, registrado_en, rectificado_en, estado_anterior, notas_anteriores
     FROM qc_medication_intake_log
     WHERE paciente_id = ?
     ORDER BY fecha_hora DESC
     LIMIT ?`,
    [pacienteId, limit],
  );
}

export async function getMedicationIntakesForDate(
  connection: SqlConnection,
  pacienteId: string,
  datePrefix: string,
): Promise<MedicationIntakeLogEntry[]> {
  return connection.all<MedicationIntakeLogEntry>(
    `SELECT id, paciente_id, medicamento_id, medicamento_nombre, dosis, fecha_civil, horario_programado, es_programado, fecha_hora, estado, notas, registrado_en, rectificado_en, estado_anterior, notas_anteriores
     FROM qc_medication_intake_log
     WHERE paciente_id = ? AND (fecha_civil = ? OR fecha_hora LIKE ?)
     ORDER BY horario_programado ASC, fecha_hora ASC`,
    [pacienteId, datePrefix, `${datePrefix}%`],
  );
}

export async function getIntakeEventsForToma(
  connection: SqlConnection,
  tomaId: string,
): Promise<MedicationIntakeEvent[]> {
  return connection.all<MedicationIntakeEvent>(
    `SELECT id, toma_id, paciente_id, medicamento_id, tipo_evento, estado_nuevo, estado_anterior, notas, creado_en
     FROM qc_medication_intake_events
     WHERE toma_id = ?
     ORDER BY creado_en ASC`,
    [tomaId],
  );
}

export async function getIntakeEventsForPatient(
  connection: SqlConnection,
  pacienteId: string,
  limit = 50,
): Promise<MedicationIntakeEvent[]> {
  return connection.all<MedicationIntakeEvent>(
    `SELECT id, toma_id, paciente_id, medicamento_id, tipo_evento, estado_nuevo, estado_anterior, notas, creado_en
     FROM qc_medication_intake_events
     WHERE paciente_id = ?
     ORDER BY creado_en DESC
     LIMIT ?`,
    [pacienteId, limit],
  );
}
