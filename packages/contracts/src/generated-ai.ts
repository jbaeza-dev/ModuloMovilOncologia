// Generated from the unchanged upstream schemas. Run pnpm generate; do not edit.
// Numeric/string limits and conditional business constraints are checked at runtime.

export type AiChatRequest = {
  "mensaje": string;
  "activar_alarmas"?: boolean;
};

export type AiChatResponse = {
  "respuesta": string;
  "fuentes": Array<AiFuenteItem>;
  "requiere_urgencia": boolean;
  "confianza_nivel": string;
  "estado_respuesta": AiEstadoRespuesta;
  "debug"?: (AiDebugInfo | null);
};

export type AiDebugInfo = {
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

export type AiEstadoRespuesta = "respuesta" | "sin_informacion" | "cortesia" | "no_disponible";

export type AiFuenteItem = {
  "tema_id": string;
  "guia": number;
  "tema": string;
};
