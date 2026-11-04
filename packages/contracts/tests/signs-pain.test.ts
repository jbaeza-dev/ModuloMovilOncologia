import { describe, expect, it } from 'vitest';
import { documents, validateRequest, validateResponse } from '../src/index.js';
const base = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  fecha_registro: '2026-10-29T10:00:00Z',
  temperatura: 36.8,
};
describe('ampliación propia ENA v1', () => {
  it('conserva RC3.2 y las capturas antiguas sin añadirles dolor', () => {
    const before = JSON.stringify(documents.clinical);
    expect(validateRequest('C-06', { body: base }).valid).toBe(true);
    expect(JSON.stringify(documents.clinical)).toBe(before);
    expect(base).not.toHaveProperty('dolor_ena');
  });
  it.each([0, 1, 7, 10])('acepta ENA %s y su ACK, también en lote mixto', (pain) => {
    const body = { ...base, version_dolor: 1, dolor_ena: pain };
    expect(validateRequest('C-06', { body }).valid).toBe(true);
    expect(validateRequest('C-07', { body: { registros: [base, body] } }).valid).toBe(true);
    expect(
      validateResponse('C-06', 201, {
        ...body,
        sincronizado: true,
        fecha_subida: base.fecha_registro,
      }).valid,
    ).toBe(true);
  });
  it.each([-1, 11, 1.5, '4', null])('rechaza ENA inválida %s sin coerción', (pain) => {
    expect(
      validateRequest('C-06', { body: { ...base, version_dolor: 1, dolor_ena: pain } }).valid,
    ).toBe(false);
  });
  it('exige versión y ENA juntas y rechaza campos desconocidos en la ampliación', () => {
    for (const extra of [
      { dolor_ena: 3 },
      { version_dolor: 1 },
      { version_dolor: 2, dolor_ena: 3 },
      { version_dolor: 1, dolor_ena: 3, inventado: true },
    ])
      expect(validateRequest('C-06', { body: { ...base, ...extra } }).valid).toBe(false);
  });
});

describe('precisión de la captura ENA, sin alterar registros RC3.2', () => {
  it.each([30, 36.8, 37.7, 45])(
    'acepta temperatura nueva %s sin errores de coma flotante',
    (temperatura) => {
      expect(
        validateRequest('C-06', { body: { ...base, version_dolor: 1, dolor_ena: 0, temperatura } })
          .valid,
      ).toBe(true);
    },
  );
  it('rechaza más de un decimal en la ampliación sin redondear ni modificar RC3.2', () => {
    expect(validateRequest('C-06', { body: { ...base, temperatura: 37.55 } }).valid).toBe(true);
    expect(
      validateRequest('C-06', {
        body: { ...base, version_dolor: 1, dolor_ena: 0, temperatura: 37.55 },
      }).valid,
    ).toBe(false);
  });
});
