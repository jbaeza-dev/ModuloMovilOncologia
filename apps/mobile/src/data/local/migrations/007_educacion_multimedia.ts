export const EDUCACION_MULTIMEDIA_VERSION = 7;

export const EDUCACION_MULTIMEDIA_SQL = `
CREATE TABLE IF NOT EXISTS interaccion_educativa_local (
  paciente_id TEXT NOT NULL,
  contenido_id TEXT NOT NULL,
  youtube_video_id TEXT,
  version_origen TEXT,
  revision_declarada_en TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  PRIMARY KEY (paciente_id, contenido_id),
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id)
);

CREATE INDEX IF NOT EXISTS idx_interaccion_edu_paciente
  ON interaccion_educativa_local (paciente_id);

ALTER TABLE descarga ADD COLUMN revision_declarada INTEGER NOT NULL DEFAULT 0;
ALTER TABLE descarga ADD COLUMN revision_declarada_en TEXT;
ALTER TABLE descarga ADD COLUMN formato TEXT NOT NULL DEFAULT 'markdown';
ALTER TABLE descarga ADD COLUMN tamano_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE descarga ADD COLUMN metadata_local_json TEXT;
`;
