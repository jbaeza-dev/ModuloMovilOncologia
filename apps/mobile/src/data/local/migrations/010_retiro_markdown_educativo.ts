export const RETIRO_MARKDOWN_EDUCATIVO_VERSION = 10;

export const RETIRO_MARKDOWN_EDUCATIVO_SQL = `
CREATE TABLE descarga_v10 (
  paciente_id TEXT NOT NULL,
  contenido_id TEXT NOT NULL,
  ruta_local TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'descargando', 'descargado', 'error')),
  fecha_descarga TEXT,
  visualizada INTEGER NOT NULL DEFAULT 0 CHECK (visualizada IN (0, 1)),
  visualizada_en TEXT,
  revision_declarada INTEGER NOT NULL DEFAULT 0,
  revision_declarada_en TEXT,
  formato TEXT NOT NULL CHECK (formato IN ('png', 'jpeg', 'markdown')),
  tamano_bytes INTEGER NOT NULL DEFAULT 0,
  metadata_local_json TEXT,
  retirado_en TEXT,
  ultimo_error_retiro TEXT,
  PRIMARY KEY (paciente_id, contenido_id),
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  CHECK (
    (estado = 'descargado' AND ruta_local IS NOT NULL AND fecha_descarga IS NOT NULL)
    OR (estado != 'descargado')
  ),
  CHECK (formato <> 'markdown' OR retirado_en IS NOT NULL)
);

INSERT INTO descarga_v10 (
  paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
  visualizada, visualizada_en, revision_declarada, revision_declarada_en,
  formato, tamano_bytes, metadata_local_json, retirado_en, ultimo_error_retiro
)
SELECT
  paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
  visualizada, visualizada_en, revision_declarada, revision_declarada_en,
  COALESCE(formato, 'markdown'), tamano_bytes, metadata_local_json,
  CASE
    WHEN COALESCE(formato, 'markdown') = 'markdown' THEN COALESCE(fecha_descarga, datetime('now'))
    ELSE NULL
  END,
  NULL
FROM descarga;

DROP TABLE descarga;
ALTER TABLE descarga_v10 RENAME TO descarga;

CREATE INDEX idx_descarga_paciente_estado
  ON descarga (paciente_id, estado);
`;
