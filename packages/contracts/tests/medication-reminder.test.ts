import { describe, it, expect } from 'vitest';
import { validateRequest } from '../src/index.js';
import { normalizedReminder, medicationAvailable } from '../src/agenda.js';
const base = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  tipo: 'medicacion' as const,
  titulo: 'Aviso personal',
  zona_horaria: 'America/Santiago' as const,
  horas: ['08:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
};
describe('Extensión propia v1: medicamento de un aviso', () => {
  it('acepta el UUID de asignación para medicación y conserva avisos anteriores sin vincular', () => {
    expect(
      validateRequest('G-08', {
        body: { ...base, medicamento_paciente_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      }).valid,
    ).toBe(true);
    expect(validateRequest('G-08', { body: base }).valid).toBe(true);
  });
  it('rechaza referencia inválida, asociación con signos/ePRO y datos clínicos extra', () => {
    for (const body of [
      { ...base, medicamento_paciente_id: 'no-es-id' },
      { ...base, tipo: 'signos', medicamento_paciente_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { ...base, medicamento_nombre: 'dato clínico' },
    ])
      expect(validateRequest('G-08', { body }).valid).toBe(false);
  });
  it('normaliza y compara también el medicamento elegido, sin alterar hashes de avisos heredados', () => {
    expect(
      normalizedReminder({
        ...base,
        medicamento_paciente_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      }).medicamento_paciente_id,
    ).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(normalizedReminder({ ...base, medicamento_paciente_id: null })).toEqual(
      normalizedReminder(base),
    );
  });
  it('respeta activo y fechas civiles inclusivas del perfil, incluido su valor predeterminado', () => {
    expect(medicationAvailable({ activo: false }, '2026-11-03')).toBe(false);
    expect(medicationAvailable({}, '2026-11-03')).toBe(true);
    expect(medicationAvailable({ fecha_inicio: '2026-11-04' }, '2026-11-03')).toBe(false);
    expect(medicationAvailable({ fecha_termino: '2026-11-03' }, '2026-11-03')).toBe(true);
  });
});
