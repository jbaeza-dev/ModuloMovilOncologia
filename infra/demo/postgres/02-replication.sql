-- Aplicar después de migrar/sembrar el simulador; solo al origen sintético propio.
\set ON_ERROR_STOP on

BEGIN;
ALTER TABLE public.contenido_educativo
  ADD COLUMN IF NOT EXISTS qc_mobile_eligible BOOLEAN NOT NULL DEFAULT FALSE;

-- Un trigger impide que un cliente fuerce elegibilidad manipulando la columna.
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

ALTER TABLE public.formulario REPLICA IDENTITY FULL;
ALTER TABLE public.pregunta REPLICA IDENTITY FULL;
ALTER TABLE public.contenido_educativo REPLICA IDENTITY FULL;
GRANT SELECT ON public.formulario, public.pregunta, public.contenido_educativo TO qc_replica;

DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync' AND puballtables) THEN
    RAISE EXCEPTION 'Publicación demasiado amplia: requiere revisión, no se reemplaza silenciosamente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    CREATE PUBLICATION powersync;
  END IF;
END;
$publication$;
ALTER PUBLICATION powersync SET TABLE public.formulario, public.pregunta, public.contenido_educativo;
COMMIT;
