export const FORMULARIOS_VERSION = 4;

export const FORMULARIOS_SQL = `
CREATE TABLE cola_envio_v4 (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  tipo_entidad TEXT NOT NULL CHECK (tipo_entidad IN (
    'signos_vitales', 'sintomas', 'respuesta_formulario', 'evento_consentimiento'
  )),
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

INSERT INTO cola_envio_v4 SELECT * FROM cola_envio;
DROP TABLE cola_envio;
ALTER TABLE cola_envio_v4 RENAME TO cola_envio;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cola_entidad_registro ON cola_envio (tipo_entidad, registro_id);
CREATE INDEX IF NOT EXISTS idx_cola_elegibles ON cola_envio (paciente_id, estado, proximo_intento_en);

CREATE TABLE formulario_cache (
  formulario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  duracion_estimada_min INTEGER NOT NULL DEFAULT 3 CHECK (duracion_estimada_min >= 0),
  configuracion_json TEXT,
  retirado INTEGER NOT NULL DEFAULT 0 CHECK (retirado IN (0, 1)),
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (formulario_id, version)
);

CREATE TABLE pregunta_cache (
  formulario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  pregunta_id TEXT NOT NULL,
  texto TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('single_choice', 'multiple_choice', 'scale_0_10', 'text')),
  orden INTEGER NOT NULL CHECK (orden >= 0),
  requerida INTEGER NOT NULL DEFAULT 0 CHECK (requerida IN (0, 1)),
  configuracion_json TEXT,
  retirado INTEGER NOT NULL DEFAULT 0 CHECK (retirado IN (0, 1)),
  PRIMARY KEY (formulario_id, version, pregunta_id),
  FOREIGN KEY (formulario_id, version) REFERENCES formulario_cache(formulario_id, version)
);
CREATE INDEX idx_pregunta_orden ON pregunta_cache (formulario_id, version, orden ASC);

CREATE TABLE formulario_asignacion_cache (
  paciente_id TEXT NOT NULL,
  formulario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  estado_conocido TEXT NOT NULL DEFAULT 'activa' CHECK (estado_conocido IN ('activa', 'retirada')),
  asignacion_origen_id TEXT,
  obtenido_en TEXT NOT NULL,
  PRIMARY KEY (paciente_id, formulario_id, version),
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (formulario_id, version) REFERENCES formulario_cache(formulario_id, version)
);
CREATE INDEX idx_asignacion_paciente ON formulario_asignacion_cache (paciente_id, estado_conocido);

CREATE TABLE borrador_formulario (
  paciente_id TEXT NOT NULL,
  formulario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  entrega_id TEXT NOT NULL,
  respuestas_json TEXT NOT NULL,
  guardado_en TEXT NOT NULL,
  version_payload INTEGER NOT NULL DEFAULT 1 CHECK (version_payload >= 1),
  PRIMARY KEY (paciente_id, formulario_id, version),
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (formulario_id, version) REFERENCES formulario_cache(formulario_id, version)
);

CREATE TABLE respuesta_formulario (
  id TEXT PRIMARY KEY NOT NULL,
  paciente_id TEXT NOT NULL,
  formulario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  respuestas_json TEXT NOT NULL,
  fecha_confirmacion TEXT NOT NULL,
  creado_localmente_en TEXT NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (formulario_id, version) REFERENCES formulario_cache(formulario_id, version)
);
CREATE INDEX idx_respuesta_paciente_fecha ON respuesta_formulario (paciente_id, fecha_confirmacion DESC, id DESC);
CREATE INDEX idx_respuesta_form_ver ON respuesta_formulario (formulario_id, version);

CREATE TABLE importacion_formularios_legacy (
  paciente_id TEXT NOT NULL,
  archivo_relativo TEXT NOT NULL,
  huella_sha256 TEXT NOT NULL,
  huella_bak_sha256 TEXT,
  destino_tipo TEXT NOT NULL CHECK (destino_tipo IN ('borrador', 'respuesta', 'invalido')),
  destino_id TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('importado', 'limpieza_pendiente', 'fallido', 'revision_requerida')),
  fecha_importacion TEXT NOT NULL,
  ultimo_error TEXT,
  PRIMARY KEY (paciente_id, archivo_relativo)
);
`;
