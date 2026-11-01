-- 1. Registro de operaciones idempotentes para publicación educativa
CREATE TABLE IF NOT EXISTS qc_demo_operacion_educativa (
  operacion_id uuid PRIMARY KEY,
  operador_id uuid NOT NULL REFERENCES qc_demo_operador(id),
  contenido_id uuid NOT NULL REFERENCES contenido_educativo(id),
  archivo_sha256 text NOT NULL,
  titulo text NOT NULL,
  descripcion text NOT NULL,
  categoria text NOT NULL,
  resultado jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
