import type { ScenarioState } from './types.js';
import type { SimulatorConfig } from './config.js';
import type { AiChatResponse } from '@quimiocare/contracts';
import { GeminiAssistantClient } from './gemini-client.js';

let geminiClientInstance: GeminiAssistantClient | null = null;

function getGeminiClient(apiKey: string): GeminiAssistantClient {
  if (!geminiClientInstance) {
    geminiClientInstance = new GeminiAssistantClient({ apiKey });
  }
  return geminiClientInstance;
}

/** Deterministic single-message stub. It never stores the message or manufactures clinical advice. */
export function aiResponse(state: ScenarioState, message: string): AiChatResponse {
  const unavailable = state.escenario === 'IA_NO_DISPONIBLE';
  const urgent = state.escenario === 'IA_URGENCIA';
  const courtesy = /^(hola|gracias|adiós|adios)[.!\s]*$/iu.test(message.trim());
  const noInformation = message.trim() === 'DEMO_SIN_INFORMACION';
  return {
    respuesta: unavailable
      ? 'Respuesta sintética: servicio de generación no disponible.'
      : urgent
        ? 'Respuesta sintética de prueba de urgencia; no se ha avisado a un profesional.'
        : courtesy
          ? 'Saludo sintético del simulador QuimioCare.'
          : 'Respuesta sintética del contrato: consulte los contenidos validados de su equipo de salud.',
    fuentes: [],
    requiere_urgencia: urgent,
    confianza_nivel: unavailable || urgent || courtesy ? 'ninguna' : 'baja',
    estado_respuesta:
      unavailable || urgent
        ? 'no_disponible'
        : courtesy
          ? 'cortesia'
          : noInformation
            ? 'sin_informacion'
            : 'respuesta',
    debug: null,
  };
}

/** Real execution via Gemini API (gemini-3.5-flash-lite) with graceful fallback to synthetic stub. */
export async function executeAiChat(
  config: SimulatorConfig,
  state: ScenarioState,
  message: string,
  activarAlarmas = true,
): Promise<AiChatResponse> {
  if (state.escenario === 'IA_NO_DISPONIBLE' || state.escenario === 'IA_URGENCIA') {
    return aiResponse(state, message);
  }

  if (config.geminiApiKey) {
    try {
      const client = getGeminiClient(config.geminiApiKey);
      return await client.ask(message, activarAlarmas);
    } catch (error) {
      console.warn('[qc-ai] Error invocando Gemini API, aplicando fallback determinista:', error);
      const fallback = aiResponse(state, message);
      return {
        ...fallback,
        debug: {
          origen: 'gemini-fallback',
          modelo: 'gemini-3.5-flash-lite',
          confianza_score: 0.1,
          confianza_razon: `Fallback aplicado tras error en Gemini: ${
            error instanceof Error ? error.message : String(error)
          }`,
          motivos_alarma: [],
          keywords: [],
          temas: [],
          tokens_prompt: 0,
          tokens_respuesta: 0,
          ms_busqueda: 0,
          ms_llm: 0,
        },
      };
    }
  }

  return aiResponse(state, message);
}
