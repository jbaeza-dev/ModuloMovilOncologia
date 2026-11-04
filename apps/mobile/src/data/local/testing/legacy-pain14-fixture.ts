/** Frozen schema of the superseded, local P07 v14; migration fixture only. */
export const legacyPain14Sql = `
CREATE TABLE signos_vitales_v14 (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  id_ficha_clinica TEXT,
  tratamiento_id TEXT,
  fecha_registro TEXT NOT NULL,
  presion_sistolica INTEGER,
  presion_diastolica INTEGER,
  pulso INTEGER,
  temperatura REAL,
  saturacion_o2 INTEGER,
  dolor_ena INTEGER CHECK (dolor_ena IS NULL OR (typeof(dolor_ena) = 'integer' AND dolor_ena BETWEEN 0 AND 10)),
  creado_localmente_en TEXT NOT NULL,
  fecha_subida TEXT,
  CHECK (temperatura IS NOT NULL OR presion_sistolica IS NOT NULL
    OR presion_diastolica IS NOT NULL OR pulso IS NOT NULL OR saturacion_o2 IS NOT NULL OR dolor_ena IS NOT NULL),
  CHECK (temperatura IS NULL OR temperatura > 0),
  CHECK (presion_sistolica IS NULL OR presion_sistolica > 0),
  CHECK (presion_diastolica IS NULL OR presion_diastolica > 0),
  CHECK (pulso IS NULL OR pulso > 0),
  CHECK (saturacion_o2 IS NULL OR (saturacion_o2 > 0 AND saturacion_o2 <= 100))
);
INSERT INTO signos_vitales_v14 (
  id,paciente_id,id_ficha_clinica,tratamiento_id,fecha_registro,presion_sistolica,
  presion_diastolica,pulso,temperatura,saturacion_o2,creado_localmente_en,fecha_subida
)
SELECT id,paciente_id,id_ficha_clinica,tratamiento_id,fecha_registro,presion_sistolica,
  presion_diastolica,pulso,temperatura,saturacion_o2,creado_localmente_en,fecha_subida
FROM signos_vitales;
DROP TABLE signos_vitales;
ALTER TABLE signos_vitales_v14 RENAME TO signos_vitales;
CREATE INDEX idx_signos_paciente_fecha ON signos_vitales (paciente_id,fecha_registro DESC,id DESC);
`;
