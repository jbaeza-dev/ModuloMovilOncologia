import { describe, expect, it } from 'vitest';
import {
  InputError,
  parseSymptomDescription,
  parseVitalInput,
  normalizeVitalValues,
  validateCaptureTimestamp,
  validateVitalInput,
  type VitalInput,
} from './validation';

const blank: VitalInput = {
  temperature: '',
  systolic: '',
  diastolic: '',
  pulse: '',
  saturation: '',
  pain: '0',
};

describe('validateVitalInput y parseVitalInput', () => {
  it('rechaza formulario completamente vacío con error general', () => {
    const res = validateVitalInput({ ...blank, pain: '' });
    expect(res.valid).toBe(false);
    expect(res.generalError).toBe('Ingresa al menos una medición.');
    expect(res.errors.pain).toBeDefined();

    expect(() => parseVitalInput({ ...blank, pain: '' })).toThrow(InputError);
  });

  it('permite registrar solo temperatura tanto con punto como con coma', () => {
    const withComma = validateVitalInput({ ...blank, temperature: '36,8' });
    expect(withComma.valid).toBe(true);
    expect(withComma.values.temperatura).toBe(36.8);
    expect(withComma.values.presion_sistolica).toBeNull();

    const withDot = validateVitalInput({ ...blank, temperature: '36.8' });
    expect(withDot.valid).toBe(true);
    expect(withDot.values.temperatura).toBe(36.8);
  });

  it('permite registrar solo pulso', () => {
    const res = validateVitalInput({ ...blank, pulse: '72' });
    expect(res.valid).toBe(true);
    expect(res.values.pulso).toBe(72);
    expect(res.values.temperatura).toBeNull();
  });

  it('permite registrar solo saturación', () => {
    const res = validateVitalInput({ ...blank, saturation: '98' });
    expect(res.valid).toBe(true);
    expect(res.values.saturacion_o2).toBe(98);
  });

  it('permite registrar solo presión arterial si ambos valores son válidos', () => {
    const res = validateVitalInput({ ...blank, systolic: '120', diastolic: '80' });
    expect(res.valid).toBe(true);
    expect(res.values.presion_sistolica).toBe(120);
    expect(res.values.presion_diastolica).toBe(80);
  });

  it('permite cada presión por separado como establece el contrato', () => {
    const missingDia = validateVitalInput({ ...blank, systolic: '120' });
    expect(missingDia.valid).toBe(true);
    expect(missingDia.values.presion_diastolica).toBeNull();

    const missingSys = validateVitalInput({ ...blank, diastolic: '80' });
    expect(missingSys.valid).toBe(true);
    expect(missingSys.values.presion_sistolica).toBeNull();
  });

  it('rechaza presiones simultáneas iguales o invertidas sin interpretar gravedad', () => {
    expect(validateVitalInput({ ...blank, systolic: '80', diastolic: '80' }).valid).toBe(false);
    expect(validateVitalInput({ ...blank, systolic: '80', diastolic: '120' }).valid).toBe(false);
  });

  it.each([
    ['temperature', '30', '45', '29.9', '45.1'],
    ['systolic', '40', '300', '39', '301'],
    ['diastolic', '30', '200', '29', '201'],
    ['pulse', '30', '250', '29', '251'],
    ['saturation', '50', '100', '49', '101'],
  ] as const)('respeta ambos extremos RC3.2 para %s', (field, min, max, below, above) => {
    expect(validateVitalInput({ ...blank, [field]: min }).valid).toBe(true);
    expect(validateVitalInput({ ...blank, [field]: max }).valid).toBe(true);
    expect(validateVitalInput({ ...blank, [field]: below }).valid).toBe(false);
    expect(validateVitalInput({ ...blank, [field]: above }).valid).toBe(false);
  });

  it('normaliza temperatura antes de guardar y rechaza valores directos no contractuales', () => {
    const input = {
      temperatura: 36.6,
      dolor_ena: 0,
      presion_sistolica: null,
      presion_diastolica: null,
      pulso: null,
      saturacion_o2: null,
    };
    expect(normalizeVitalValues(input).temperatura).toBe(36.6);
    expect(() => normalizeVitalValues({ ...input, temperatura: 36.66 })).toThrow(InputError);
    expect(() => normalizeVitalValues({ ...input, pulso: 251 })).toThrow(InputError);
    expect(() => normalizeVitalValues({ ...input, temperatura: Number.NaN })).toThrow(InputError);
  });

  it('admite la frontera de cinco minutos futuros y conserva capturas antiguas al reintentar', () => {
    const now = Date.parse('2026-10-27T20:00:00Z');
    expect(() => validateCaptureTimestamp('2026-10-27T20:05:00.000Z', now)).not.toThrow();
    expect(() => validateCaptureTimestamp('2026-10-27T20:05:00.001Z', now)).toThrow(InputError);
    expect(() => validateCaptureTimestamp('2026-10-20T10:00:00-03:00', now)).not.toThrow();
    expect(() => validateCaptureTimestamp('2026-10-27T20:00:00', now)).toThrow(InputError);
    expect(() => validateCaptureTimestamp('2026-02-30T10:00:00Z', now)).toThrow(InputError);
    expect(() => validateCaptureTimestamp('2026-02-29T10:00:00Z', now)).toThrow(InputError);
    expect(() => validateCaptureTimestamp('2024-02-29T10:00:00Z', now)).not.toThrow();
  });

  it('admite presión arterial completa sin imponer reglas clínicas inventadas', () => {
    const valid = validateVitalInput({ ...blank, systolic: '120', diastolic: '80' });
    expect(valid.valid).toBe(true);
    expect(valid.values.presion_sistolica).toBe(120);
    expect(valid.values.presion_diastolica).toBe(80);
  });

  it('asocia errores de formato numérico a los campos respectivos', () => {
    const res = validateVitalInput({
      temperature: 'abc',
      systolic: '120.5', // debe ser entero
      diastolic: '80',
      pulse: 'rapido',
      pain: '0',
      saturation: '105', // excede 100
    });

    expect(res.valid).toBe(false);
    expect(res.errors.temperature).toBe('Temperatura: ingresa un número válido.');
    expect(res.errors.systolic).toBe('Presión sistólica: ingresa un número válido.');
    expect(res.errors.pulse).toBe('Pulso: ingresa un número válido.');
    expect(res.errors.saturation).toBe('Saturación: ingresa un valor entre 50 y 100.');
  });

  it('parseSymptomDescription valida longitud máxima de 2.000 caracteres', () => {
    expect(() => parseSymptomDescription('')).toThrow(InputError);
    expect(() => parseSymptomDescription('   ')).toThrow(InputError);
    expect(parseSymptomDescription('Dolor de cabeza leve')).toBe('Dolor de cabeza leve');
    const tooLong = 'a'.repeat(2001);
    expect(() => parseSymptomDescription(tooLong)).toThrow(InputError);
  });
});
