export const DESCARGAS_VERSION = 3;

export const DESCARGAS_SQL = `
CREATE TABLE IF NOT EXISTS descarga (
  paciente_id TEXT NOT NULL,
  contenido_id TEXT NOT NULL,
  ruta_local TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'descargando', 'descargado', 'error')),
  fecha_descarga TEXT,
  visualizada INTEGER NOT NULL DEFAULT 0 CHECK (visualizada IN (0, 1)),
  visualizada_en TEXT,
  PRIMARY KEY (paciente_id, contenido_id),
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  CHECK (
    (estado = 'descargado' AND ruta_local IS NOT NULL AND fecha_descarga IS NOT NULL)
    OR (estado != 'descargado')
  )
);

CREATE INDEX IF NOT EXISTS idx_descarga_paciente_estado
  ON descarga (paciente_id, estado);
`;
