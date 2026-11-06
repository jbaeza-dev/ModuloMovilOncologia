UPDATE qc_demo_plantilla_sintetica
SET perfil_clinico_template=jsonb_set(perfil_clinico_template,'{medicamentos}',(
 SELECT jsonb_agg(jsonb_build_object(
  'id',gen_random_uuid(),'medicamento_id',gen_random_uuid(),'nombre',nombre,
  'dosis','Individualizada por el equipo de oncología',
  'frecuencia','Administración por el equipo de oncología según ciclo',
  'motivo','Componente del esquema mFOLFOX6. Ejemplo académico, sin indicación domiciliaria.',
  'activo',false,'fecha_inicio',NULL,'fecha_termino',NULL))
 FROM (VALUES ('Oxaliplatino'),('Ácido folínico (leucovorina)'),('Fluorouracilo (5-FU)')) AS medicamentos(nombre)
))
WHERE id='DEMO-FOLFOX-v1' AND (
 COALESCE(perfil_clinico_template->'medicamentos','[]'::jsonb)='[]'::jsonb OR
 perfil_clinico_template->'medicamentos' @> '[{"nombre":"Medicamento sintético"}]'::jsonb
);

