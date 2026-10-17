import { describe, expect, it } from 'vitest';
import {
  InputError,
  parseSymptomDescription,
  parseVitalInput,
  validateVitalInput,
  type VitalInput,
} from './validation';

const blank: VitalInput = {
  temperature: '',
  systolic: '',
  diastolic: '',
  pulse: '',
  saturation: '',
};

describe('validateVitalInput y parseVitalInput', () => {
  it('rechaza formulario completamente vacío con error general', () => {
    const res = validateVitalInput(blank);
    expect(res.valid).toBe(false);
    expect(res.generalError).toBe('Ingresa al menos una medición.');
    expect(Object.keys(res.errors)).toHaveLength(0);

    expect(() => parseVitalInput(blank)).toThrow(InputError);
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

  it('exige ambos valores de presión arterial e identifica el faltante', () => {
    const missingDia = validateVitalInput({ ...blank, systolic: '120' });
    expect(missingDia.valid).toBe(false);
    expect(missingDia.errors.diastolic).toBe('Ingresa la presión diastólica.');

    const missingSys = validateVitalInput({ ...blank, diastolic: '80' });
    expect(missingSys.valid).toBe(false);
    expect(missingSys.errors.systolic).toBe('Ingresa la presión sistólica.');
  });

  it('rechaza si la presión sistólica es menor o igual a la diastólica', () => {
    const equal = validateVitalInput({ ...blank, systolic: '100', diastolic: '100' });
    expect(equal.valid).toBe(false);
    expect(equal.errors.systolic).toBe('La presión sistólica debe ser mayor que la diastólica.');

    const lower = validateVitalInput({ ...blank, systolic: '80', diastolic: '120' });
    expect(lower.valid).toBe(false);
    expect(lower.errors.systolic).toBe('La presión sistólica debe ser mayor que la diastólica.');
  });

  it('asocia errores de formato numérico a los campos respectivos', () => {
    const res = validateVitalInput({
      temperature: 'abc',
      systolic: '120.5', // debe ser entero
      diastolic: '80',
      pulse: 'rapido',
      saturation: '105', // excede 100
    });

    expect(res.valid).toBe(false);
    expect(res.errors.temperature).toBe('Temperatura: ingresa un número válido.');
    expect(res.errors.systolic).toBe('Presión sistólica: ingresa un número válido.');
    expect(res.errors.pulse).toBe('Pulso: ingresa un número válido.');
    expect(res.errors.saturation).toBe('Saturación: ingresa un valor válido.');
  });

  it('parseSymptomDescription valida longitud máxima de 2.000 caracteres', () => {
    expect(() => parseSymptomDescription('')).toThrow(InputError);
    expect(() => parseSymptomDescription('   ')).toThrow(InputError);
    expect(parseSymptomDescription('Dolor de cabeza leve')).toBe('Dolor de cabeza leve');
    const tooLong = 'a'.repeat(2001);
    expect(() => parseSymptomDescription(tooLong)).toThrow(InputError);
  });
});
