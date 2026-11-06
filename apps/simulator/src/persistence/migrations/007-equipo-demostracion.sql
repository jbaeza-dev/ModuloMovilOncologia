-- Perfil profesional ficticio explícito; una cuenta administrativa no acredita profesión.
CREATE TABLE qc_demo_profesional (
  operador_id uuid PRIMARY KEY REFERENCES qc_demo_operador(id),
  nombre text NOT NULL,
  especialidad text NOT NULL,
  origen text NOT NULL DEFAULT 'simulacion' CHECK (origen='simulacion')
);
INSERT INTO qc_demo_profesional(operador_id,nombre,especialidad)
SELECT id,'Dra. Camila Rojas — demostración','Oncología médica (perfil ficticio)'
FROM qc_demo_operador WHERE activo=true;

-- Completar únicamente el ejemplo FOLFOX vacío; conservar indicaciones existentes.
UPDATE qc_demo_paciente p
SET perfil_clinico = jsonb_set(p.perfil_clinico, '{medicamentos}', (
  SELECT jsonb_agg(jsonb_build_object(
    'id',gen_random_uuid(),'medicamento_id',gen_random_uuid(),'nombre',nombre,
    'dosis','Individualizada por el equipo de oncología',
    'frecuencia','Administración por el equipo de oncología según ciclo',
    'motivo','Componente del esquema mFOLFOX6. Ejemplo académico, sin indicación domiciliaria.',
    'activo',false,'fecha_inicio',NULL,'fecha_termino',NULL))
  FROM (VALUES ('Oxaliplatino'),('Ácido folínico (leucovorina)'),('Fluorouracilo (5-FU)')) AS medicamentos(nombre)
))
WHERE p.perfil_clinico IS NOT NULL
AND COALESCE(p.perfil_clinico->'medicamentos','[]'::jsonb)='[]'::jsonb
AND EXISTS (SELECT 1 FROM qc_demo_relacion_clinica r
            WHERE r.paciente_id=p.id AND r.plantilla_id='DEMO-FOLFOX-v1' AND r.estado='activa');
