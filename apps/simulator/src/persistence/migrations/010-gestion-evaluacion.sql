ALTER TABLE qc_preparacion_categoria ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE qc_preparacion_categoria ADD COLUMN activo boolean NOT NULL DEFAULT true;
ALTER TABLE contenido_educativo ADD COLUMN categoria_habilitada boolean NOT NULL DEFAULT true;
ALTER TABLE qc_demo_relacion_clinica ADD COLUMN profesional_activo boolean NOT NULL DEFAULT true;
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

