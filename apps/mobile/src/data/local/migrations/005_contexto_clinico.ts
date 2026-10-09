export const CONTEXTO_CLINICO_VERSION = 5;

export const CONTEXTO_CLINICO_SQL = `
CREATE TABLE ficha_clinica_cache (
  ficha_id TEXT NOT NULL PRIMARY KEY,
  paciente_id TEXT NOT NULL UNIQUE,
  obtenido_en TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ficha_paciente_id ON ficha_clinica_cache (paciente_id, ficha_id);

CREATE TABLE profesional_medico_cache (
  id TEXT NOT NULL PRIMARY KEY,
  nombre TEXT NOT NULL,
  especialidad TEXT NOT NULL,
  email TEXT,
  obtenido_en TEXT NOT NULL
);

CREATE TABLE paciente_clinico_cache (
  id TEXT NOT NULL PRIMARY KEY,
  paciente_id TEXT NOT NULL,
  profesional_id TEXT NOT NULL,
  estado_conocido TEXT NOT NULL CHECK (estado_conocido IN ('activo', 'inactivo', 'revocado')),
  fecha_vinculacion TEXT NOT NULL,
  codigo_origen TEXT,
  obtenido_en TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (profesional_id) REFERENCES profesional_medico_cache(id),
  UNIQUE (paciente_id, profesional_id)
);
CREATE INDEX IF NOT EXISTS idx_paciente_clinico_paciente ON paciente_clinico_cache (paciente_id, estado_conocido);

CREATE TABLE medicamento_activo_cache (
  id TEXT NOT NULL PRIMARY KEY,
  paciente_id TEXT NOT NULL,
  ficha_id TEXT,
  nombre TEXT NOT NULL,
  dosis TEXT NOT NULL,
  frecuencia TEXT NOT NULL,
  fecha_inicio TEXT,
  fecha_fin TEXT,
  estado_activo INTEGER NOT NULL DEFAULT 1 CHECK (estado_activo IN (0, 1)),
  obtenido_en TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (paciente_id, ficha_id) REFERENCES ficha_clinica_cache(paciente_id, ficha_id)
);
CREATE INDEX IF NOT EXISTS idx_medicamento_paciente_estado ON medicamento_activo_cache (paciente_id, estado_activo);
`;
