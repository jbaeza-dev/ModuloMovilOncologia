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

export class InputError extends Error {
  fieldErrors?: Partial<Record<keyof VitalInput, string>>;
  constructor(message: string, fieldErrors?: Partial<Record<keyof VitalInput, string>>) {
    super(message);
    this.name = 'InputError';
    this.fieldErrors = fieldErrors;
  }
}

export interface VitalValidationResult {
  valid: boolean;
  values: VitalValues;
  errors: Partial<Record<keyof VitalInput, string>>;
  generalError?: string;
}

export function validateVitalInput(input: VitalInput): VitalValidationResult {
  const errors: Partial<Record<keyof VitalInput, string>> = {};
  let generalError: string | undefined;

  function parseField(
    raw: string,
    key: keyof VitalInput,
    label: string,
    integer: boolean,
    max?: number,
  ): number | null {
    const value = raw.trim();
    if (!value) return null;
    if (!/^\d+(?:[.,]\d+)?$/.test(value) || (integer && !/^\d+$/.test(value))) {
      errors[key] = `${label}: ingresa un número válido.`;
      return null;
    }
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
      errors[key] = `${label}: ingresa un valor válido.`;
      return null;
    }
    return parsed;
  }

  const temperatura = parseField(input.temperature, 'temperature', 'Temperatura', false);
  const presion_sistolica = parseField(input.systolic, 'systolic', 'Presión sistólica', true);
  const presion_diastolica = parseField(input.diastolic, 'diastolic', 'Presión diastólica', true);
  const pulso = parseField(input.pulse, 'pulse', 'Pulso', true);
  const saturacion_o2 = parseField(input.saturation, 'saturation', 'Saturación', true, 100);

  const hasSysRaw = input.systolic.trim().length > 0;
  const hasDiaRaw = input.diastolic.trim().length > 0;

  if (hasSysRaw && !hasDiaRaw) {
    errors.diastolic = 'Ingresa la presión diastólica.';
  } else if (!hasSysRaw && hasDiaRaw) {
    errors.systolic = 'Ingresa la presión sistólica.';
  }

  const hasAnyInput =
    input.temperature.trim().length > 0 ||
    hasSysRaw ||
    hasDiaRaw ||
    input.pulse.trim().length > 0 ||
    input.saturation.trim().length > 0;

  if (!hasAnyInput) {
    generalError = 'Ingresa al menos una medición.';
  }

  const valid = Object.keys(errors).length === 0 && !generalError;

  return {
    valid,
    values: {
      temperatura,
      presion_sistolica,
      presion_diastolica,
      pulso,
      saturacion_o2,
    },
    errors,
    generalError,
  };
}

export function parseVitalInput(input: VitalInput): VitalValues {
  const result = validateVitalInput(input);
  if (!result.valid) {
    if (result.generalError) {
      throw new InputError(result.generalError, result.errors);
    }
    const hasSysRaw = input.systolic.trim().length > 0;
    const hasDiaRaw = input.diastolic.trim().length > 0;
    if ((hasSysRaw && !hasDiaRaw) || (!hasSysRaw && hasDiaRaw)) {
      throw new InputError('Ingresa ambos valores de presión arterial.', result.errors);
    }
    const fieldOrder: Array<keyof VitalInput> = [
      'temperature',
      'systolic',
      'diastolic',
      'pulse',
      'saturation',
    ];
    for (const key of fieldOrder) {
      if (result.errors[key]) {
        throw new InputError(result.errors[key]!, result.errors);
      }
    }
    throw new InputError('Datos de medición inválidos.', result.errors);
  }
  return result.values;
}

export function parseSymptomDescription(raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 2000) {
    throw new InputError('Describe el síntoma en un máximo de 2.000 caracteres.');
  }
  return value;
}
