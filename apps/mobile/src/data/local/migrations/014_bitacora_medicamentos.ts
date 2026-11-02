export const BITACORA_MEDICAMENTOS_VERSION = 14;
export const BITACORA_MEDICAMENTOS_SQL = `
CREATE TABLE IF NOT EXISTS qc_medication_intake_log (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  medicamento_id TEXT NOT NULL,
  medicamento_nombre TEXT NOT NULL,
  dosis TEXT,
  fecha_hora TEXT NOT NULL,
  estado TEXT NOT NULL CHECK(estado IN ('taken', 'omitted')),
  notas TEXT,
  registrado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qc_med_intake_paciente_fecha
  ON qc_medication_intake_log (paciente_id, fecha_hora);
`;
