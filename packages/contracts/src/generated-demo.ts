// Generated from the unchanged upstream schemas. Run pnpm generate; do not edit.
// Numeric/string limits and conditional business constraints are checked at runtime.

export type DemoErrorDemo = {
  "error": {
  "codigo": string;
  "mensaje": string;
};
};

export type DemoElegirPaciente = {
  "paciente_demo": "A" | "B";
};

export type DemoRenovarToken = {
  "refresh_token": string;
};

export type DemoTokenDemo = {
  "access_token": string;
  "refresh_token": string;
  "token_type": "bearer";
  "expires_in": 3600;
  "user": {
  "id": string;
  "paciente_demo": "A" | "B";
};
};

export type DemoEscenario = {
  "id": "NORMAL" | "ACK_SIGNOS_PERDIDO" | "ACK_EPRO_PERDIDO" | "SESION_EXPIRADA" | "AUTORIZACION_DENEGADA" | "TERMINOS_NUEVOS" | "EDUCACION_RETIRADA" | "IA_NO_DISPONIBLE" | "IA_URGENCIA" | "EDICION_CONDICIONAL" | "EXCLUSIVIDAD_ACTIVA" | "SERVICIO_NO_DISPONIBLE";
  "descripcion": string;
};

export type DemoEscenarios = {
  "items": Array<DemoEscenario>;
};

export type DemoSeleccionEscenario = {
  "paciente_demo": "A" | "B";
  "escenario": "NORMAL" | "ACK_SIGNOS_PERDIDO" | "ACK_EPRO_PERDIDO" | "SESION_EXPIRADA" | "AUTORIZACION_DENEGADA" | "TERMINOS_NUEVOS" | "EDUCACION_RETIRADA" | "IA_NO_DISPONIBLE" | "IA_URGENCIA" | "EDICION_CONDICIONAL" | "EXCLUSIVIDAD_ACTIVA" | "SERVICIO_NO_DISPONIBLE";
};

export type DemoEstadoEscenario = {
  "paciente_demo": "A" | "B";
  "escenario": "NORMAL" | "ACK_SIGNOS_PERDIDO" | "ACK_EPRO_PERDIDO" | "SESION_EXPIRADA" | "AUTORIZACION_DENEGADA" | "TERMINOS_NUEVOS" | "EDUCACION_RETIRADA" | "IA_NO_DISPONIBLE" | "IA_URGENCIA" | "EDICION_CONDICIONAL" | "EXCLUSIVIDAD_ACTIVA" | "SERVICIO_NO_DISPONIBLE";
  "aplicado_en": string;
};

export type DemoResetDemo = {
  "confirmar": "REINICIAR_DATOS_SINTETICOS";
  "seed": "quimiocare-rc32-v1";
};

export type DemoResultadoReset = {
  "seed": "quimiocare-rc32-v1";
  "reiniciado_en": string;
};
