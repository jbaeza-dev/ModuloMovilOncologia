/** Technical capture domains from RC3.2; never clinical urgency thresholds. */
export const VITAL_DOMAINS = {
  temperature: { min: 30, max: 45, integer: false },
  systolic: { min: 40, max: 300, integer: true },
  diastolic: { min: 30, max: 200, integer: true },
  pulse: { min: 30, max: 250, integer: true },
  saturation: { min: 50, max: 100, integer: true },
  pain: { min: 0, max: 10, integer: true },
} as const;

export type VitalInput = {
  temperature: string;
  systolic: string;
  diastolic: string;
  pulse: string;
  saturation: string;
  pain: string;
};

export type VitalValues = {
  temperatura: number | null;
  presion_sistolica: number | null;
  presion_diastolica: number | null;
  pulso: number | null;
  saturacion_o2: number | null;
  /** Missing/null is historical; required when recording a new capture. */
  dolor_ena?: number | null;
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

  function parseField(raw: string, key: keyof VitalInput, label: string): number | null {
    const { min, max, integer } = VITAL_DOMAINS[key];
    const value = raw.trim();
    if (!value) return null;
    if (!/^\d+(?:[.,]\d+)?$/.test(value) || (integer && !/^\d+$/.test(value))) {
      errors[key] = `${label}: ingresa un número válido.`;
      return null;
    }
    if (key === 'temperature' && /[.,]\d{2,}$/.test(value)) {
      errors[key] = 'Temperatura: usa como máximo un decimal, sin redondear la lectura.';
      return null;
    }
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      errors[key] = `${label}: ingresa un valor entre ${min} y ${max}.`;
      return null;
    }
    return parsed;
  }

  // Input limits come from SignoVitalRegistroInput (RC3.2), not triage thresholds.
  const rawTemperature = parseField(input.temperature, 'temperature', 'Temperatura');
  const temperatura = rawTemperature === null ? null : Number(rawTemperature.toFixed(1));
  const presion_sistolica = parseField(input.systolic, 'systolic', 'Presión sistólica');
  const presion_diastolica = parseField(input.diastolic, 'diastolic', 'Presión diastólica');
  const pulso = parseField(input.pulse, 'pulse', 'Pulso');
  const saturacion_o2 = parseField(input.saturation, 'saturation', 'Saturación');

  const dolor_ena = parseField(input.pain ?? '', 'pain', 'Dolor ENA');
  if (!(input.pain ?? '').trim()) errors.pain = 'Ingresa tu dolor ENA de 0 a 10.';

  const hasSysRaw = input.systolic.trim().length > 0;
  const hasDiaRaw = input.diastolic.trim().length > 0;

  if (
    presion_sistolica !== null &&
    presion_diastolica !== null &&
    presion_sistolica <= presion_diastolica
  ) {
    errors.systolic = 'La presión sistólica debe ser mayor que la diastólica.';
  }

  const hasAnyInput =
    input.temperature.trim().length > 0 ||
    hasSysRaw ||
    hasDiaRaw ||
    input.pulse.trim().length > 0 ||
    input.saturation.trim().length > 0 ||
    (input.pain ?? '').trim().length > 0;

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
      dolor_ena,
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
    const fieldOrder: Array<keyof VitalInput> = [
      'temperature',
      'systolic',
      'diastolic',
      'pulse',
      'saturation',
      'pain',
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

/** Apply the same contractual limits at the durable repository boundary. */
export function normalizeVitalValues(values: VitalValues): VitalValues {
  if (Object.values(values).some((value) => value != null && typeof value !== 'number')) {
    throw new InputError('Las mediciones deben ser números.');
  }
  const text = (value: number | null) => (value == null ? '' : String(value));
  return parseVitalInput({
    temperature: text(values.temperatura),
    systolic: text(values.presion_sistolica),
    diastolic: text(values.presion_diastolica),
    pulse: text(values.pulso),
    saturation: text(values.saturacion_o2),
    pain: text(values.dolor_ena ?? null),
  });
}

/** A queued capture keeps its original timestamp; retries never replace it with upload time. */
export function validateCaptureTimestamp(value: string, referenceNow = Date.now()): void {
  const captured = Date.parse(value);
  const calendar = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  const year = Number(calendar?.[1]),
    month = Number(calendar?.[2]),
    day = Number(calendar?.[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    !calendar ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1] ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(captured) ||
    !Number.isFinite(referenceNow) ||
    captured > referenceNow + 5 * 60 * 1000
  ) {
    throw new InputError('La fecha de captura no es válida o supera cinco minutos en el futuro.');
  }
}

export function parseSymptomDescription(raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 2000) {
    throw new InputError('Describe el síntoma en un máximo de 2.000 caracteres.');
  }
  return value;
}
