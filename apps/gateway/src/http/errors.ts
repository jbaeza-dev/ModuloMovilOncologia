export type ErrorCode =
  | 'ORIGEN_NO_PERMITIDO'
  | 'DATOS_INVALIDOS'
  | 'SOLICITUD_DEMASIADO_GRANDE'
  | 'AUTENTICACION_NO_CONFIGURADA'
  | 'SERVICIO_NO_DISPONIBLE'
  | 'ERROR_SERVIDOR'
  | 'RUTA_NO_ENCONTRADA'
  | 'IA_TIEMPO_AGOTADO'
  | 'IA_RESPUESTA_INVALIDA';
const messages: Record<ErrorCode, string> = {
  ORIGEN_NO_PERMITIDO: 'Origen de navegador no habilitado.',
  DATOS_INVALIDOS: 'Solicitud incompatible con el contrato.',
  SOLICITUD_DEMASIADO_GRANDE: 'El cuerpo supera el límite permitido.',
  AUTENTICACION_NO_CONFIGURADA: 'La autenticación del gateway aún no está habilitada.',
  SERVICIO_NO_DISPONIBLE: 'Servicio temporalmente no disponible.',
  ERROR_SERVIDOR: 'No fue posible completar la solicitud.',
  RUTA_NO_ENCONTRADA: 'Ruta no encontrada.',
  IA_TIEMPO_AGOTADO: 'Se agotó el tiempo de espera del asistente.',
  IA_RESPUESTA_INVALIDA: 'El asistente devolvió una respuesta incompatible.',
};
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(messages[code]);
  }
}
export function errorEnvelope(error: GatewayError, requestId: string) {
  return { error: { codigo: error.code, mensaje: error.message, solicitud_id: requestId } };
}
