import { describe, expect, it } from 'vitest';
import { calculateDv, cleanRut, formatRut, validateRut } from './rut-chileno';

describe('rut-chileno', () => {
  it('cleanRut cleans non-alphanumeric and capitalizes K', () => {
    expect(cleanRut(' 12.345.678-k ')).toBe('12345678K');
    expect(cleanRut('19-876-543-2')).toBe('198765432');
  });

  it('calculateDv calculates correct verification digit', () => {
    // Casos reales conocidos
    expect(calculateDv('11111111')).toBe('1');
    expect(calculateDv('12345678')).toBe('5');
    expect(calculateDv('76192083')).toBe('9');
  });

  it('validateRut validates correct and incorrect RUTs', () => {
    expect(validateRut('12.345.678-5')).toBe(true);
    expect(validateRut('12345678-5')).toBe(true);
    expect(validateRut('123456785')).toBe(true);
    expect(validateRut('12.345.678-K')).toBe(false);
    expect(validateRut('12345678-4')).toBe(false);
    expect(validateRut('1-9')).toBe(false); // muy corto
  });

  it('formatRut applies periods and hyphen correctly', () => {
    expect(formatRut('1')).toBe('1');
    expect(formatRut('12')).toBe('1-2');
    expect(formatRut('123')).toBe('12-3');
    expect(formatRut('1234')).toBe('123-4');
    expect(formatRut('12345')).toBe('1.234-5');
    expect(formatRut('12345678k')).toBe('12.345.678-K');
  });
});
