export const BITACORA_PROGRAMACION_VERSION = 15;
export const BITACORA_PROGRAMACION_SQL = `
-- Migración 15: Programación determinista, rectificaciones e historial inmutable de tomas
CREATE TABLE IF NOT EXISTS qc_medication_intake_log_v15 (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  medicamento_id TEXT NOT NULL,
  medicamento_nombre TEXT NOT NULL,
  dosis TEXT,
  fecha_civil TEXT NOT NULL,
  horario_programado TEXT NOT NULL,
  fecha_hora TEXT NOT NULL,
  estado TEXT NOT NULL CHECK(estado IN ('taken', 'omitted')),
  notas TEXT,
  registrado_en TEXT NOT NULL,
  rectificado_en TEXT,
  estado_anterior TEXT CHECK(estado_anterior IN ('taken', 'omitted')),
  notas_anteriores TEXT,
  UNIQUE(paciente_id, medicamento_id, fecha_civil, horario_programado)
);

-- Migración v15: Preserva todos los registros de v14 usando 'sin_horario#' || id
INSERT INTO qc_medication_intake_log_v15 (
  id, paciente_id, medicamento_id, medicamento_nombre, dosis,
  fecha_civil, horario_programado, fecha_hora, estado, notas, registrado_en,
  rectificado_en, estado_anterior, notas_anteriores
)
SELECT
  id,
  paciente_id,
  medicamento_id,
  medicamento_nombre,
  dosis,
  substr(fecha_hora, 1, 10) AS fecha_civil,
  'sin_horario#' || id AS horario_programado,
  fecha_hora,
  estado,
  notas,
  registrado_en,
  NULL AS rectificado_en,
  NULL AS estado_anterior,
  NULL AS notas_anteriores
FROM qc_medication_intake_log;

DROP TABLE qc_medication_intake_log;
ALTER TABLE qc_medication_intake_log_v15 RENAME TO qc_medication_intake_log;

CREATE INDEX IF NOT EXISTS idx_qc_med_intake_paciente_fecha
  ON qc_medication_intake_log (paciente_id, fecha_civil);
CREATE INDEX IF NOT EXISTS idx_qc_med_intake_paciente_horario
  ON qc_medication_intake_log (paciente_id, fecha_hora);

-- Tabla de eventos / auditoría inmutable de cambios y rectificaciones
CREATE TABLE IF NOT EXISTS qc_medication_intake_events (
  id TEXT PRIMARY KEY NOT NULL,
  toma_id TEXT NOT NULL,
  paciente_id TEXT NOT NULL,
  medicamento_id TEXT NOT NULL,
  tipo_evento TEXT NOT NULL CHECK(tipo_evento IN ('registro_inicial', 'rectificacion')),
  estado_nuevo TEXT NOT NULL CHECK(estado_nuevo IN ('taken', 'omitted')),
  estado_anterior TEXT CHECK(estado_anterior IN ('taken', 'omitted')),
  notas TEXT,
  creado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qc_med_events_toma
  ON qc_medication_intake_events (toma_id);
CREATE INDEX IF NOT EXISTS idx_qc_med_events_paciente
  ON qc_medication_intake_events (paciente_id, creado_en);
`;
