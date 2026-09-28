export const REGISTROS_VERSION = 1;

export const REGISTROS_SQL = `
CREATE TABLE signos_vitales (
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
  creado_localmente_en TEXT NOT NULL,
  fecha_subida TEXT,
  CHECK ((presion_sistolica IS NULL AND presion_diastolica IS NULL)
    OR (presion_sistolica IS NOT NULL AND presion_diastolica IS NOT NULL)),
  CHECK (temperatura IS NOT NULL OR presion_sistolica IS NOT NULL
    OR pulso IS NOT NULL OR saturacion_o2 IS NOT NULL),
  CHECK (temperatura IS NULL OR temperatura > 0),
  CHECK (presion_sistolica IS NULL OR (presion_sistolica > 0 AND presion_diastolica > 0)),
  CHECK (pulso IS NULL OR pulso > 0),
  CHECK (saturacion_o2 IS NULL OR (saturacion_o2 > 0 AND saturacion_o2 <= 100))
);
CREATE INDEX idx_signos_paciente_fecha
  ON signos_vitales (paciente_id, fecha_registro DESC, id DESC);

CREATE TABLE sintomas (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  tratamiento_id TEXT,
  fecha_registro TEXT NOT NULL,
  codigo_rapido TEXT,
  descripcion TEXT NOT NULL,
  creado_localmente_en TEXT NOT NULL,
  fecha_subida TEXT,
  CHECK (length(trim(descripcion)) BETWEEN 1 AND 2000)
);
CREATE INDEX idx_sintomas_paciente_fecha
  ON sintomas (paciente_id, fecha_registro DESC, id DESC);

CREATE TABLE cola_envio (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  tipo_entidad TEXT NOT NULL CHECK (tipo_entidad IN ('signos_vitales', 'sintomas')),
  registro_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente', 'enviando', 'enviado', 'error_reintentable', 'requiere_sesion', 'conflicto'
  )),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proximo_intento_en TEXT,
  ultimo_error_codigo TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  enviado_en TEXT,
  UNIQUE (tipo_entidad, registro_id)
);
CREATE INDEX idx_cola_elegibles
  ON cola_envio (paciente_id, estado, proximo_intento_en);
`;
