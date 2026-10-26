export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

export function invalid(message: string, reason?: string): never {
  throw new ApiError(422, 'REGLA_DE_NEGOCIO_INVALIDA', message, reason ? { motivo: reason } : null);
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(422, 'ERROR_VALIDACION', 'Se requiere un objeto JSON.');
  }
  return value as Record<string, unknown>;
}
