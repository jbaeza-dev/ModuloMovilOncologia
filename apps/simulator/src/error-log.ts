import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.js';

export type LineWriter = (line: string) => void;

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_DB_CODE = /^[0-9A-Z]{5}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Ruta sin parámetros y con los identificadores reemplazados, para no guardar IDs de pacientes. */
function routeShape(url: string | undefined): string {
  return (url ?? '/')
    .split('?')[0]!
    .replace(UUID, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 200);
}

function errorType(cause: unknown): string {
  if (cause instanceof ApiError) return 'ApiError';
  if (cause instanceof Error) return /^[A-Za-z]{1,40}$/.test(cause.name) ? cause.name : 'Error';
  return typeof cause;
}

/**
 * Registra en una línea JSON los errores 5xx. Igual que el gateway, usa una lista cerrada de
 * campos: nunca el mensaje del error ni el cuerpo de la solicitud, porque pueden traer datos del
 * paciente (por ejemplo, un error de PostgreSQL incluye los valores que chocaron).
 */
export function logServerError(
  write: LineWriter,
  service: string,
  req: IncomingMessage,
  apiError: ApiError,
  cause: unknown,
): void {
  if (apiError.status < 500) return;
  const requestId = req.headers['x-request-id'];
  const dbCode =
    typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  const entry = {
    timestamp: new Date().toISOString(),
    event: 'error',
    service: 'quimiocare-' + service,
    method: req.method,
    path: routeShape(req.url),
    status: apiError.status,
    code: apiError.code,
    errorType: errorType(cause),
    dbCode: typeof dbCode === 'string' && SAFE_DB_CODE.test(dbCode) ? dbCode : undefined,
    requestId:
      typeof requestId === 'string' && SAFE_REQUEST_ID.test(requestId) ? requestId : undefined,
  };
  try {
    write(JSON.stringify(entry) + '\n');
  } catch {
    // El registro nunca debe impedir responder al cliente.
  }
}
