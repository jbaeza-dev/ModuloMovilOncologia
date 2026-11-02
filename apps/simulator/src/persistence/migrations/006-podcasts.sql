-- Own educational extension; the external clinical contract remains unchanged.
CREATE TABLE qc_educacion_podcast (
  id uuid PRIMARY KEY,
  profesional_id uuid NOT NULL REFERENCES qc_demo_operador(id),
  titulo text NOT NULL,
  descripcion text NOT NULL,
  categoria text NOT NULL,
  drive_id text NOT NULL UNIQUE CHECK (drive_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  activo boolean NOT NULL DEFAULT true,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);
