-- 1. Tabla de invitaciones de pacientes (Allowlist de acceso de evaluación)
CREATE TABLE IF NOT EXISTS qc_demo_invitacion_paciente (
  email text PRIMARY KEY,
  nombre text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  activo boolean NOT NULL DEFAULT true
);

-- 2. Operadores autorizados (médicos / evaluadores del panel)
CREATE TABLE IF NOT EXISTS qc_demo_operador (
  id uuid PRIMARY KEY,
  auth_issuer text NOT NULL,
  auth_subject text NOT NULL,
  email text NOT NULL UNIQUE,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(auth_issuer, auth_subject)
);

-- 3. Adaptación de qc_demo_paciente para permitir pacientes externos individuales
ALTER TABLE qc_demo_paciente DROP CONSTRAINT IF EXISTS qc_demo_paciente_paciente_demo_check;
ALTER TABLE qc_demo_paciente ALTER COLUMN paciente_demo DROP NOT NULL;
ALTER TABLE qc_demo_paciente ADD COLUMN IF NOT EXISTS auth_issuer text;
ALTER TABLE qc_demo_paciente ADD COLUMN IF NOT EXISTS auth_subject text;
ALTER TABLE qc_demo_paciente ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE qc_demo_paciente ADD COLUMN IF NOT EXISTS estado_cuenta text NOT NULL DEFAULT 'activo';
ALTER TABLE qc_demo_paciente ALTER COLUMN perfil_clinico DROP NOT NULL;
ALTER TABLE qc_demo_paciente ALTER COLUMN tratamiento DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'qc_demo_paciente_federated_idx'
  ) THEN
    CREATE UNIQUE INDEX qc_demo_paciente_federated_idx ON qc_demo_paciente(auth_issuer, auth_subject);
  END IF;
END $$;

-- 4. Plantillas clínicas sintéticas preaprobadas
CREATE TABLE IF NOT EXISTS qc_demo_plantilla_sintetica (
  id text PRIMARY KEY,
  nombre text NOT NULL,
  descripcion text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  perfil_clinico_template jsonb NOT NULL,
  tratamiento_template jsonb NOT NULL,
  activo boolean NOT NULL DEFAULT true
);

-- 5. Códigos de vinculación y relación clínica activa
ALTER TABLE qc_demo_vinculacion ADD COLUMN IF NOT EXISTS consumido boolean NOT NULL DEFAULT false;
ALTER TABLE qc_demo_vinculacion ADD COLUMN IF NOT EXISTS consumido_en timestamptz;
ALTER TABLE qc_demo_vinculacion ADD COLUMN IF NOT EXISTS consumido_por uuid REFERENCES qc_demo_operador(id);
ALTER TABLE qc_demo_vinculacion ADD COLUMN IF NOT EXISTS request_token uuid;

CREATE TABLE IF NOT EXISTS qc_demo_relacion_clinica (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id uuid NOT NULL REFERENCES qc_demo_paciente(id) UNIQUE,
  operador_id uuid NOT NULL REFERENCES qc_demo_operador(id),
  plantilla_id text NOT NULL REFERENCES qc_demo_plantilla_sintetica(id),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'finalizada', 'suspendida')),
  vinculado_en timestamptz NOT NULL DEFAULT now(),
  desvinculado_en timestamptz
);

-- 6. Auditoría con hash criptográfico del código (sin almacenar secretos en texto plano)
CREATE TABLE IF NOT EXISTS qc_demo_auditoria_vinculacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operador_id uuid NOT NULL REFERENCES qc_demo_operador(id),
  paciente_id uuid NOT NULL REFERENCES qc_demo_paciente(id),
  relacion_id uuid NOT NULL REFERENCES qc_demo_relacion_clinica(id),
  codigo_sha256 text NOT NULL,
  plantilla_id text NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now(),
  ip_origen text
);
