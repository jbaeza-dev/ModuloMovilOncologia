import { expect, it } from 'vitest';
import { readableTreatmentText } from './treatment-labels';
it('presents treatment identifiers as words without modifying stored values', () => {
  expect(readableTreatmentText('en_curso')).toBe('En curso');
  expect(readableTreatmentText('tratamiento_adyuvante')).toBe('Tratamiento adyuvante');
  expect(readableTreatmentText(' __peso__actual ')).toBe('Peso actual');
  expect(readableTreatmentText('HER2 positivo')).toBe('HER2 positivo');
});
