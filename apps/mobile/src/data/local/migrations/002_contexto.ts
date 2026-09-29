export const CONTEXTO_VERSION = 2;

export const CONTEXTO_SQL = `
CREATE TABLE paciente_cache (
  paciente_id TEXT PRIMARY KEY NOT NULL,
  nombre TEXT NOT NULL,
  email TEXT,
  rut TEXT,
  telefono TEXT,
  fecha_nacimiento TEXT,
  ciudad TEXT,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  obtenido_en TEXT NOT NULL
);

CREATE TABLE tratamiento_cache (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo = 'quimioterapia'),
  estado TEXT NOT NULL,
  nombre TEXT NOT NULL,
  equipo_tratante TEXT,
  ciclo_actual INTEGER,
  total_ciclos INTEGER,
  parametros_json TEXT,
  fecha_inicio TEXT,
  fecha_termino TEXT,
  obtenido_en TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id) ON DELETE CASCADE
);

CREATE INDEX idx_tratamiento_paciente_estado
  ON tratamiento_cache (paciente_id, estado);

CREATE TABLE codigo_vinculacion_cache (
  paciente_id TEXT PRIMARY KEY NOT NULL,
  codigo TEXT NOT NULL,
  expira_en TEXT NOT NULL,
  estado_conocido TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado_conocido IN ('pendiente', 'usado', 'expirado')),
  obtenido_en TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id) ON DELETE CASCADE
);
`;
