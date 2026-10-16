export const RECORDATORIOS_LOCALES_VERSION = 8;

export const RECORDATORIOS_LOCALES_SQL = `
-- 1. Índice compuesto para satisfacer FK compuesta de medicación
CREATE UNIQUE INDEX IF NOT EXISTS idx_medicamento_paciente_id
  ON medicamento_activo_cache (paciente_id, id);

-- 2. Catálogo local de tipos de recordatorios
CREATE TABLE tipo_notificacion_local (
  codigo TEXT NOT NULL PRIMARY KEY,
  descripcion TEXT NOT NULL,
  canal TEXT NOT NULL
);

INSERT OR IGNORE INTO tipo_notificacion_local (codigo, descripcion, canal) VALUES
  ('registro_vitales', 'Recordatorio de registro de signos vitales', 'recordatorios_salud'),
  ('medicacion', 'Recordatorio de toma o consulta de medicación', 'recordatorios_salud');

-- 3. Preferencias de avisos por paciente
CREATE TABLE preferencia_avisos (
  paciente_id TEXT NOT NULL PRIMARY KEY,
  habilitado INTEGER NOT NULL DEFAULT 0 CHECK (habilitado IN (0, 1)),
  actualizado_el TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id)
);

-- 4. Reglas de recordatorios locales
CREATE TABLE recordatorio_local (
  id TEXT NOT NULL PRIMARY KEY,
  paciente_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  medicamento_id TEXT,
  dias_semana TEXT NOT NULL,
  horas_minutos TEXT NOT NULL,
  zona_horaria TEXT NOT NULL,
  fecha_inicio TEXT,
  fecha_fin TEXT,
  habilitado INTEGER NOT NULL DEFAULT 0 CHECK (habilitado IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  eliminado_el TEXT,
  creado_el TEXT NOT NULL,
  actualizado_el TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (tipo) REFERENCES tipo_notificacion_local(codigo),
  FOREIGN KEY (paciente_id, medicamento_id) REFERENCES medicamento_activo_cache(paciente_id, id),
  CHECK (
    (tipo = 'medicacion' AND medicamento_id IS NOT NULL) OR
    (tipo = 'registro_vitales' AND medicamento_id IS NULL)
  ),
  CHECK (fecha_inicio IS NULL OR fecha_fin IS NULL OR fecha_inicio <= fecha_fin)
);

CREATE INDEX IF NOT EXISTS idx_recordatorio_paciente_activo
  ON recordatorio_local (paciente_id, habilitado, eliminado_el);

-- 5. Índice único requerido para satisfacer la FK compuesta de notificacion_local
CREATE UNIQUE INDEX IF NOT EXISTS idx_recordatorio_paciente_id
  ON recordatorio_local (paciente_id, id);

-- 6. Trabajos programados y observaciones
CREATE TABLE notificacion_local (
  id TEXT NOT NULL PRIMARY KEY,
  paciente_id TEXT NOT NULL,
  recordatorio_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  fecha_prevista_utc TEXT NOT NULL,
  id_nativo TEXT,
  estado TEXT NOT NULL CHECK (
    estado IN ('pendiente', 'programada', 'cancelacion_pendiente', 'cancelada', 'finalizada_sin_observacion', 'error')
  ),
  payload_minimo TEXT NOT NULL,
  error TEXT,
  recibida_observada_en TEXT,
  abierta_en TEXT,
  creado_el TEXT NOT NULL,
  actualizado_el TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (paciente_id, recordatorio_id) REFERENCES recordatorio_local(paciente_id, id),
  FOREIGN KEY (tipo) REFERENCES tipo_notificacion_local(codigo),
  UNIQUE (paciente_id, recordatorio_id, revision, fecha_prevista_utc)
);

CREATE INDEX IF NOT EXISTS idx_notificacion_paciente_estado_fecha
  ON notificacion_local (paciente_id, estado, fecha_prevista_utc);

CREATE INDEX IF NOT EXISTS idx_notificacion_nativo
  ON notificacion_local (id_nativo);
`;
