export type ErrorCode =
  | 'NO_AUTORIZADO'
  | 'ACCESO_DENEGADO'
  | 'REGISTRO_EN_CONFLICTO'
  | 'SESION_REVOCADA'
  | 'SESION_NO_ENCONTRADA'
  | 'VERSION_EN_CONFLICTO'
  | 'OPERACION_EN_CONFLICTO'
  | 'RECORDATORIO_NO_ENCONTRADO'
  | 'FUNCION_NO_DISPONIBLE'
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
  NO_AUTORIZADO: 'Se requiere una sesión válida.',
  ACCESO_DENEGADO: 'La cuenta no tiene acceso a esta operación.',
  REGISTRO_EN_CONFLICTO: 'El registro no está disponible para esta asociación.',
  SESION_REVOCADA: 'La asociación está revocada.',
  SESION_NO_ENCONTRADA: 'Asociación no encontrada.',
  VERSION_EN_CONFLICTO: 'El registro cambió; consulta su versión actual.',
  OPERACION_EN_CONFLICTO: 'La operación no coincide con el registro original.',
  RECORDATORIO_NO_ENCONTRADO: 'Recordatorio no encontrado.',
  FUNCION_NO_DISPONIBLE: 'Esta función aún no está habilitada.',
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
