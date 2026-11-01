-- Preserve stable fixture identities when upgrading an existing evaluation database.
INSERT INTO qc_preparacion_terminos_vigentes(codigo,definicion_id)
SELECT codigo,id FROM qc_demo_terminos
WHERE id='e4951e1f-16a9-5e91-a1a6-a49b4cfe8c01'::uuid
ON CONFLICT DO NOTHING;

-- Only unambiguous active selections may be adopted automatically.
INSERT INTO qc_preparacion_formulario_vigente(tratamiento,formulario_id)
SELECT tratamiento,(array_agg(id))[1] FROM formulario
WHERE activo AND NOT eliminado GROUP BY tratamiento HAVING count(*)=1
ON CONFLICT DO NOTHING;
