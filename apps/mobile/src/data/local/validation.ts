export type VitalInput = {
  temperature: string;
  systolic: string;
  diastolic: string;
  pulse: string;
  saturation: string;
};

export type VitalValues = {
  temperatura: number | null;
  presion_sistolica: number | null;
  presion_diastolica: number | null;
  pulso: number | null;
  saturacion_o2: number | null;
};

export class InputError extends Error {}

function positiveNumber(raw: string, label: string, integer: boolean, max?: number): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(value) || (integer && !/^\d+$/.test(value))) {
    throw new InputError(`${label}: ingresa un número válido.`);
  }
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    throw new InputError(`${label}: ingresa un valor válido.`);
  }
  return parsed;
}

export function parseVitalInput(input: VitalInput): VitalValues {
  const values = {
    temperatura: positiveNumber(input.temperature, 'Temperatura', false),
    presion_sistolica: positiveNumber(input.systolic, 'Presión sistólica', true),
    presion_diastolica: positiveNumber(input.diastolic, 'Presión diastólica', true),
    pulso: positiveNumber(input.pulse, 'Pulso', true),
    saturacion_o2: positiveNumber(input.saturation, 'Saturación', true, 100),
  };
  if ((values.presion_sistolica === null) !== (values.presion_diastolica === null)) {
    throw new InputError('Ingresa ambos valores de presión arterial.');
  }
  if (Object.values(values).every((value) => value === null)) {
    throw new InputError('Ingresa al menos una medición.');
  }
  return values;
}

export function parseSymptomDescription(raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 2000) {
    throw new InputError('Describe el síntoma en un máximo de 2.000 caracteres.');
  }
  return value;
}
