export const CONSENTIMIENTOS_VERSION = 6;

export const CONSENTIMIENTOS_SQL = `
CREATE TABLE definicion_terminos_cache (
  termino_id TEXT NOT NULL,
  version TEXT NOT NULL,
  titulo TEXT NOT NULL,
  contenido_markdown TEXT NOT NULL,
  requerido INTEGER NOT NULL DEFAULT 1 CHECK (requerido IN (0, 1)),
  vigente_desde TEXT NOT NULL,
  vigente_hasta TEXT,
  huella_sha256 TEXT NOT NULL,
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (termino_id, version)
);

CREATE TABLE consentimiento_usuario (
  id TEXT NOT NULL PRIMARY KEY,
  paciente_id TEXT NOT NULL,
  termino_id TEXT NOT NULL,
  version TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('otorgado', 'revocado')),
  fecha_otorgamiento TEXT NOT NULL,
  fecha_revocacion TEXT,
  creado_en TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (termino_id, version) REFERENCES definicion_terminos_cache(termino_id, version),
  UNIQUE (id, paciente_id, termino_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consentimiento_activo ON consentimiento_usuario (paciente_id, termino_id, version) WHERE estado = 'otorgado';
CREATE INDEX IF NOT EXISTS idx_consentimiento_paciente ON consentimiento_usuario (paciente_id, creado_en DESC);

CREATE TABLE evento_consentimiento (
  id TEXT NOT NULL PRIMARY KEY,
  paciente_id TEXT NOT NULL,
  consentimiento_id TEXT NOT NULL,
  termino_id TEXT NOT NULL,
  version TEXT NOT NULL,
  secuencia INTEGER NOT NULL CHECK (secuencia > 0),
  accion TEXT NOT NULL CHECK (accion IN ('otorgado', 'revocado')),
  fecha_evento TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (consentimiento_id, paciente_id, termino_id, version) REFERENCES consentimiento_usuario(id, paciente_id, termino_id, version),
  UNIQUE (paciente_id, secuencia)
);
CREATE INDEX IF NOT EXISTS idx_evento_consentimiento_secuencia ON evento_consentimiento (paciente_id, secuencia ASC);
`;
