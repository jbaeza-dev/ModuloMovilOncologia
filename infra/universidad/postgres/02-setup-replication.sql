-- Configuración de replicación lógica PowerSync tras la migración del esquema en qc_demo
\set ON_ERROR_STOP on

BEGIN;

-- 1. Asegurar columna y trigger de elegibilidad móvil para contenido educativo
ALTER TABLE public.contenido_educativo
  ADD COLUMN IF NOT EXISTS qc_mobile_eligible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.contenido_educativo ADD COLUMN IF NOT EXISTS categoria_habilitada boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.qc_mobile_education_eligibility()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  SELECT activo INTO NEW.categoria_habilitada FROM qc_preparacion_categoria WHERE clave=lower(btrim(NEW.categoria)) FOR SHARE;
  NEW.categoria_habilitada := coalesce(NEW.categoria_habilitada,true);
  NEW.qc_mobile_eligible := COALESCE(
    NEW.activo AND NEW.categoria_habilitada
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

-- 2. Configurar REPLICA IDENTITY FULL para que las operaciones DELETE/UPDATE envíen toda la fila a PowerSync
ALTER TABLE public.formulario REPLICA IDENTITY FULL;
ALTER TABLE public.pregunta REPLICA IDENTITY FULL;
ALTER TABLE public.contenido_educativo REPLICA IDENTITY FULL;
ALTER TABLE public.qc_demo_paciente REPLICA IDENTITY FULL;

-- 3. Otorgar permisos SELECT al usuario de replicación
GRANT SELECT ON public.formulario, public.pregunta, public.contenido_educativo, public.qc_demo_paciente TO qc_replica;

-- 4. Actualizar publicación de PowerSync
ALTER PUBLICATION powersync SET TABLE public.formulario, public.pregunta, public.contenido_educativo, public.qc_demo_paciente;

COMMIT;
