import { expect, it } from 'vitest';
import { folfoxDemo } from '../src/folfox-demo.js';

it('prepares mFOLFOX6 chemotherapy with active realistic medications and frequencies', () => {
  const source = { id: 'preserved-profile', medicamentos: [] };
  const result = folfoxDemo(source, { id: 'preserved-treatment', parametros: { ciclo_actual: 2 } });
  expect(result.clinical).toMatchObject({ id: source.id });
  expect(result.clinical.medicamentos).toHaveLength(3);
  expect(
    result.clinical.medicamentos.every(
      (m) =>
        m.activo === true &&
        m.fecha_inicio === null &&
        m.frecuencia.includes('cada 14 días') &&
        !m.motivo.toLowerCase().includes('prueba') &&
        !m.motivo.toLowerCase().includes('ejemplo académico'),
    ),
  ).toBe(true);
  expect(result.treatment.codigo_icd10).toBe('C18.9');
  expect(result.treatment.parametros).toMatchObject({ ciclo_actual: 2 });
  expect(source.medicamentos).toEqual([]);
});
