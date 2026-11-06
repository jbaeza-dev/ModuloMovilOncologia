UPDATE qc_demo_plantilla_sintetica
SET
  descripcion = 'Pauta clínica adyuvante basada en el protocolo estándar mFOLFOX6 (oxaliplatino, ácido folínico y fluorouracilo en ciclos de 14 días).',
  perfil_clinico_template = jsonb_set(
    perfil_clinico_template,
    '{medicamentos}',
    jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(),
        'medicamento_id', gen_random_uuid(),
        'nombre', 'Oxaliplatino',
        'dosis', '85 mg/m² en infusión IV de 2 horas',
        'frecuencia', 'Día 1 de cada ciclo cada 14 días',
        'motivo', 'Componente del esquema mFOLFOX6: agente alquilante de platino en infusión intravenosa.',
        'activo', true,
        'fecha_inicio', NULL,
        'fecha_termino', NULL
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'medicamento_id', gen_random_uuid(),
        'nombre', 'Ácido folínico (leucovorina)',
        'dosis', '400 mg/m² en infusión IV de 2 horas',
        'frecuencia', 'Día 1 de cada ciclo cada 14 días',
        'motivo', 'Componente del esquema mFOLFOX6: modulador bioquímico para potenciar el fluorouracilo.',
        'activo', true,
        'fecha_inicio', NULL,
        'fecha_termino', NULL
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'medicamento_id', gen_random_uuid(),
        'nombre', 'Fluorouracilo (5-FU)',
        'dosis', '400 mg/m² en bolo IV y 2400 mg/m² en infusión continua de 46 horas',
        'frecuencia', 'Día 1 (bolo e inicio de infusión continua por 46 h) cada 14 días',
        'motivo', 'Componente del esquema mFOLFOX6: antimetabolito fluoropirimidínico en bolo e infusión continua.',
        'activo', true,
        'fecha_inicio', NULL,
        'fecha_termino', NULL
      )
    )
  ),
  tratamiento_template = jsonb_set(
    tratamiento_template,
    '{parametros,observaciones}',
    '"Pauta clínica adyuvante mFOLFOX6 en ciclos cada 14 días hasta completar 12 ciclos (oxaliplatino 85 mg/m² IV día 1, ácido folínico 400 mg/m² IV día 1 y fluorouracilo 400 mg/m² en bolo IV seguido de 2400 mg/m² en infusión continua por 46 horas). Protocolo de referencia clínica eviQ 637."'::jsonb
  )
WHERE id = 'DEMO-FOLFOX-v1';

UPDATE qc_demo_paciente p
SET
  perfil_clinico = jsonb_set(
    p.perfil_clinico,
    '{medicamentos}',
    t.perfil_clinico_template->'medicamentos'
  ),
  tratamiento = CASE
    WHEN p.tratamiento IS NOT NULL AND jsonb_typeof(p.tratamiento) = 'object' AND p.tratamiento <> '{}'::jsonb
      THEN jsonb_set(
        p.tratamiento,
        '{parametros,observaciones}',
        t.tratamiento_template #> '{parametros,observaciones}'
      )
    ELSE p.tratamiento
  END,
  actualizado_en = now()
FROM qc_demo_relacion_clinica r
JOIN qc_demo_plantilla_sintetica t ON t.id = r.plantilla_id
WHERE p.id = r.paciente_id
  AND r.plantilla_id = 'DEMO-FOLFOX-v1'
  AND r.estado = 'activa'
  AND jsonb_typeof(p.perfil_clinico) = 'object';
