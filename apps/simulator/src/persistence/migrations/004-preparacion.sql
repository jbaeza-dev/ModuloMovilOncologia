CREATE TABLE qc_preparacion_categoria (
  clave text PRIMARY KEY,
  nombre text NOT NULL
);
INSERT INTO qc_preparacion_categoria(clave,nombre)
SELECT lower(btrim(categoria)),min(btrim(categoria)) FROM contenido_educativo
WHERE btrim(coalesce(categoria,'')) <> '' GROUP BY lower(btrim(categoria));

CREATE TABLE qc_preparacion_terminos_vigentes (
  codigo text PRIMARY KEY,
  definicion_id uuid NOT NULL REFERENCES qc_demo_terminos(id)
);
CREATE TABLE qc_preparacion_formulario_vigente (
  tratamiento text PRIMARY KEY,
  formulario_id uuid NOT NULL REFERENCES formulario(id)
);
CREATE TABLE qc_preparacion_operacion (
  operacion_id uuid PRIMARY KEY,
  operador_id uuid NOT NULL REFERENCES qc_demo_operador(id),
  accion text NOT NULL,
  payload_sha256 text NOT NULL,
  resultado jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE qc_preparacion_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL REFERENCES qc_preparacion_operacion(operacion_id),
  operador_id uuid NOT NULL REFERENCES qc_demo_operador(id),
  paciente_id uuid REFERENCES qc_demo_paciente(id),
  definicion_id uuid REFERENCES qc_demo_terminos(id),
  accion text NOT NULL,
  origen text NOT NULL DEFAULT 'simulacion' CHECK(origen='simulacion'),
  creado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contenido_educativo
  ADD COLUMN IF NOT EXISTS qc_mobile_eligible BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.qc_mobile_education_eligibility()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  NEW.qc_mobile_eligible := COALESCE(
    NEW.activo
    AND btrim(NEW.titulo) <> ''
    AND btrim(NEW.categoria) <> ''
    AND btrim(NEW.url) <> ''
    AND (
      (NEW.tipo = 'imagen'
        AND NEW.archivo_mime IN ('image/png', 'image/jpeg')
        AND NEW.archivo_tamano_bytes > 0
        AND NEW.archivo_revision IS NOT NULL
        AND NEW.archivo_sha256 ~ '^[0-9a-f]{64}$')
      OR
      (NEW.tipo = 'video'
        AND NEW.archivo_mime IS NULL
        AND NEW.archivo_tamano_bytes IS NULL
        AND NEW.archivo_revision IS NULL
        AND NEW.archivo_sha256 IS NULL)
    ), FALSE);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS qc_mobile_education_eligibility ON public.contenido_educativo;
CREATE TRIGGER qc_mobile_education_eligibility
BEFORE INSERT OR UPDATE ON public.contenido_educativo
FOR EACH ROW EXECUTE FUNCTION public.qc_mobile_education_eligibility();

UPDATE public.contenido_educativo SET activo = activo;


ALTER TABLE qc_demo_paciente ADD COLUMN nombre_origen text NOT NULL DEFAULT 'manual';
UPDATE qc_demo_paciente p SET nombre_origen='invitacion' FROM qc_demo_invitacion_paciente i
WHERE lower(p.email)=lower(i.email) AND p.perfil->>'nombre'=i.nombre;
