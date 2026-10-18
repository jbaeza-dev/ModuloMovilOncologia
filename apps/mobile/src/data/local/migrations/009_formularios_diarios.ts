export const FORMULARIOS_DIARIOS_VERSION = 9;

export const FORMULARIOS_DIARIOS_SQL = `
CREATE TABLE borrador_formulario_v9 (
  paciente_id TEXT NOT NULL,
  formulario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  periodo_clave TEXT NOT NULL,
  fecha_seguimiento TEXT,
  zona_horaria TEXT,
  iniciado_en TEXT,
  ventana_desde TEXT,
  ventana_hasta TEXT,
  paso_actual TEXT,
  entrega_id TEXT NOT NULL,
  respuestas_json TEXT NOT NULL,
  guardado_en TEXT NOT NULL,
  version_payload INTEGER NOT NULL DEFAULT 2 CHECK (version_payload >= 1),
  PRIMARY KEY (paciente_id, formulario_id, version, periodo_clave),
  FOREIGN KEY (paciente_id) REFERENCES paciente_cache(paciente_id),
  FOREIGN KEY (formulario_id, version) REFERENCES formulario_cache(formulario_id, version)
);

INSERT INTO borrador_formulario_v9 (
  paciente_id, formulario_id, version, periodo_clave, entrega_id, respuestas_json, guardado_en, version_payload
)
SELECT paciente_id, formulario_id, version, 'legacy', entrega_id, respuestas_json, guardado_en, version_payload
FROM borrador_formulario;

DROP TABLE borrador_formulario;
ALTER TABLE borrador_formulario_v9 RENAME TO borrador_formulario;

ALTER TABLE respuesta_formulario ADD COLUMN fecha_seguimiento TEXT;
ALTER TABLE respuesta_formulario ADD COLUMN zona_horaria TEXT;
ALTER TABLE respuesta_formulario ADD COLUMN iniciado_en TEXT;
ALTER TABLE respuesta_formulario ADD COLUMN ventana_desde TEXT;
ALTER TABLE respuesta_formulario ADD COLUMN ventana_hasta TEXT;

CREATE INDEX idx_respuesta_diaria ON respuesta_formulario (
  paciente_id, formulario_id, fecha_seguimiento, fecha_confirmacion DESC, id DESC
);
`;
