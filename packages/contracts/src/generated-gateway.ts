// Generated from the unchanged upstream schemas. Run pnpm generate; do not edit.
// Numeric/string limits and conditional business constraints are checked at runtime.

export type GatewayError = {
  "error": {
  "codigo": string;
  "mensaje": string;
  "detalles"?: Record<string, unknown> | null;
  "solicitud_id"?: string;
};
};

export type GatewaySalud = {
  "estado": "ok";
  "servicio": "quimiocare-gateway";
  "version": string;
};

export type GatewaySesion = {
  "id": string;
  "instalacion_id": string;
  "plataforma": "android";
  "proveedor_push": "expo" | "fcm";
  "activa": boolean;
  "version": number;
  "ultima_conexion": string;
  "creado_en": string;
  "actualizado_en": string;
  "token_registrado": boolean;
};

export type GatewaySesionEnvelope = {
  "sesion": GatewaySesion;
};

export type GatewaySesiones = {
  "items": Array<GatewaySesion>;
  "next_cursor": string | null;
};

export type GatewayRegistroPush = {
  "sesion_id": string;
  "instalacion_id": string;
  "token_push": string;
  "proveedor_push": "expo" | "fcm";
  "plataforma": "android";
  "modelo"?: string;
  "version_app"?: string;
  "version_so"?: string;
  "version_esperada"?: number;
};

export type GatewayIAChatRequest = {
  "mensaje": string;
  "activar_alarmas"?: boolean;
};

export type GatewayIAChatResponse = {
  "respuesta": string;
  "fuentes": Array<GatewayIAFuenteItem>;
  "requiere_urgencia": boolean;
  "confianza_nivel": string;
  "estado_respuesta": GatewayIAEstadoRespuesta;
  "debug"?: (GatewayIADebugInfo | null);
};

export type GatewayIADebugInfo = {
  "origen": string;
  "confianza_score": number;
  "confianza_razon": string;
  "motivos_alarma": Array<string>;
  "keywords": Array<string>;
  "temas": Array<string>;
  "modelo": string;
  "tokens_prompt": number;
  "tokens_respuesta": number;
  "ms_busqueda": number;
  "ms_llm": number;
};

export type GatewayIAEstadoRespuesta = "respuesta" | "sin_informacion" | "cortesia" | "no_disponible";

export type GatewayIAFuenteItem = {
  "tema_id": string;
  "guia": number;
  "tema": string;
};

export type GatewayConsultaChat = {
  "mensaje": string;
  "activar_alarmas"?: boolean;
};

export type GatewayErrorIA = {
  "detail": (string | Array<Record<string, unknown>>);
};

export type GatewayConfiguracionRecordatorio = {
  "tipo": "epro" | "signos" | "medicacion";
  "titulo": string;
  "zona_horaria": "America/Santiago";
  "horas": Array<string>;
  "dias_semana": Array<number>;
  "fecha_inicio": string;
  "fecha_fin": string | null;
  "activo": boolean;
};

export type GatewayCrearRecordatorio = {
  "id": string;
  "tipo": "epro" | "signos" | "medicacion";
  "titulo": string;
  "zona_horaria": "America/Santiago";
  "horas": Array<string>;
  "dias_semana": Array<number>;
  "fecha_inicio": string;
  "fecha_fin": string | null;
  "activo": boolean;
};

export type GatewayReemplazarRecordatorio = {
  "version_esperada": number;
  "tipo": "epro" | "signos" | "medicacion";
  "titulo": string;
  "zona_horaria": "America/Santiago";
  "horas": Array<string>;
  "dias_semana": Array<number>;
  "fecha_inicio": string;
  "fecha_fin": string | null;
  "activo": boolean;
};

export type GatewayRecordatorio = {
  "id": string;
  "tipo": "epro" | "signos" | "medicacion";
  "titulo": string;
  "zona_horaria": "America/Santiago";
  "horas": Array<string>;
  "dias_semana": Array<number>;
  "fecha_inicio": string;
  "fecha_fin": string | null;
  "activo": boolean;
  "version": number;
  "creado_en": string;
  "actualizado_en": string;
  "canal": "push_con_respaldo_local";
  "respaldo_segundos": 120;
};

export type GatewayRecordatorioEnvelope = {
  "recordatorio": GatewayRecordatorio;
  "version_agenda": number;
  "hora_servidor": string;
};

export type GatewayCumplimiento = {
  "operacion_id": string;
  "tipo_registro": "epro" | "signos";
  "fecha_local": string;
  "zona_horaria": "America/Santiago";
  "registrado_en": string;
};

export type GatewayRegistrarCumplimientos = {
  "items": Array<GatewayCumplimiento>;
};

export type GatewayAckCumplimiento = {
  "operacion_id": string;
  "resultado": "registrado" | "replay";
};

export type GatewayResultadoCumplimientos = {
  "items": Array<GatewayAckCumplimiento>;
  "version_agenda": number;
  "hora_servidor": string;
};

export type GatewayEstadoDiario = {
  "tipo_registro": "epro" | "signos";
  "fecha_local": string;
  "zona_horaria": "America/Santiago";
  "cumplido": true;
};

export type GatewayAgenda = {
  "version_agenda": number;
  "hora_servidor": string;
  "desde": string;
  "hasta": string;
  "recordatorios": Array<GatewayRecordatorio>;
  "cumplimientos": Array<GatewayEstadoDiario>;
  "politica": {
  "canal": "push_con_respaldo_local";
  "respaldo_segundos": 120;
  "ventana_tardia_segundos": 600;
  "horizonte_local_dias": 14;
  "maximo_avisos_locales": 64;
};
};

export type GatewayAcuse = {
  "operacion_id": string;
  "sesion_id": string;
  "ocurrencia_id": string;
  "evento": "push_procesado" | "respaldo_observado" | "abierto";
  "ocurrido_en": string;
};

export type GatewayRegistrarAcuses = {
  "items": Array<GatewayAcuse>;
};

export type GatewayAckAcuse = {
  "operacion_id": string;
  "resultado": "registrado" | "replay";
};

export type GatewayResultadoAcuses = {
  "items": Array<GatewayAckAcuse>;
  "hora_servidor": string;
};

export type GatewayPayloadNotificacion = {
  "tipo": "recordatorio";
  "sesion_id": string;
  "recordatorio_id": string;
  "version_recordatorio": number;
  "ocurrencia_id": string;
  "programado_en": string;
  "respaldo_en": string;
  "vence_en": string;
};
