import type { ScenarioState } from './types.js';
import type { SimulatorConfig } from './config.js';
import type { AiChatResponse } from '@quimiocare/contracts';
import { GeminiAssistantClient, GEMINI_MODEL } from './gemini-client.js';

let geminiClientInstance: GeminiAssistantClient | null = null;

function getGeminiClient(apiKey: string): GeminiAssistantClient {
  if (!geminiClientInstance) {
    geminiClientInstance = new GeminiAssistantClient({ apiKey });
  }
  return geminiClientInstance;
}

/** Deterministic single-message stub for explicit demo scenarios. */
export function aiResponse(
  state: ScenarioState,
  message: string,
  includeDebug = false,
): AiChatResponse {
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
    debug: includeDebug
      ? {
          origen: 'simulator-stub',
          modelo: 'synthetic-stub-v1',
          confianza_score: 0.1,
          confianza_razon: 'Respuesta sintética predeterminada del simulador',
          motivos_alarma: urgent ? ['simulador_urgencia'] : [],
          keywords: [],
          temas: [],
          tokens_prompt: 0,
          tokens_respuesta: 0,
          ms_busqueda: 0,
          ms_llm: 0,
        }
      : null,
  };
}

/** Real execution via Gemini API with controlled unavailability on failure. */
export async function executeAiChat(
  config: SimulatorConfig,
  state: ScenarioState,
  message: string,
  activarAlarmas = true,
  includeDebug = false,
  requestId?: string,
): Promise<AiChatResponse> {
  // Respect explicit test scenarios
  if (state.escenario === 'IA_NO_DISPONIBLE' || state.escenario === 'IA_URGENCIA') {
    return aiResponse(state, message, includeDebug);
  }

  // If Gemini API Key is configured, use real provider
  if (config.geminiApiKey) {
    try {
      const client = getGeminiClient(config.geminiApiKey);
      return await (requestId !== undefined
        ? client.ask(message, activarAlarmas, includeDebug, requestId)
        : client.ask(message, activarAlarmas, includeDebug));
    } catch (error) {
      console.warn(
        `[qc-ai] (solicitud_id: ${requestId ?? 'sin-id'}) Error invocando Gemini API, devolviendo no_disponible:`,
        error,
      );
      return {
        respuesta:
          'En este momento no puedo responder. Por favor, inténtelo nuevamente en unos minutos o consulte con su equipo de salud.',
        fuentes: [],
        requiere_urgencia: false,
        confianza_nivel: 'ninguna',
        estado_respuesta: 'no_disponible',
        debug: includeDebug
          ? {
              origen: 'gemini-error',
              modelo: GEMINI_MODEL,
              confianza_score: 0,
              confianza_razon: `Indisponibilidad tras error en proveedor: ${
                error instanceof Error ? error.message : String(error)
              }`,
              motivos_alarma: [],
              keywords: [],
              temas: [],
              tokens_prompt: 0,
              tokens_respuesta: 0,
              ms_busqueda: 0,
              ms_llm: 0,
            }
          : null,
      };
    }
  }

  // Demo fallback when no Gemini key is provided
  return aiResponse(state, message, includeDebug);
}
