import { GoogleGenAI, Type } from '@google/genai';
import type { AiChatResponse } from '@quimiocare/contracts';

export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

export const ONCOLOGY_SYSTEM_PROMPT = `Eres el Asistente Clínico de QuimioCare, una herramienta digital de apoyo y orientación educativa para pacientes en tratamiento de quimioterapia.

Tus pautas de comunicación son:
1. BREVEDAD Y CLARIDAD:
   - Entrega respuestas breves, estructuradas y fáciles de leer en un dispositivo móvil (idealmente de 1 a 2 párrafos cortos o puntos clave).
   - Ve directo al grano con pautas prácticas y sencillas, evitando textos largos o rodeos innecesarios.

2. DELIMITACIÓN Y MARGEN DEL CONTEXTO:
   - Mantén tus respuestas estrictamente dentro del ámbito de la educación oncológica, autocuidado, alivio de síntomas comunes y bienestar durante la quimioterapia.
   - No formules diagnósticos, no prescribas fármacos ni modifiques dosis médicas. Si te consultan por temas ajenos al tratamiento, responde de forma breve y cortés que está fuera del alcance de la guía y marca 'estado_respuesta: "sin_informacion"'.

3. CALMA Y DISCRECIÓN (NO ASUSTAR AL PACIENTE):
   - Usa un tono sereno, prudente y tranquilo. Nunca alarmes, dramatices ni utilices expresiones que causen angustia (evita signos de exclamación alarmistas o advertencias fatales).
   - ANTE SÍNTOMAS DE ALARMA (fiebre >= 38.0°C, escalofríos intensos, dificultad respiratoria, sangrados inusuales o vómitos persistentes que impidan hidratarse):
     * Marca estrictamente 'requiere_urgencia: true'.
     * Aconseja con calma, claridad y naturalidad que contacte o acuda al servicio de urgencias o a su centro oncológico para una valoración médica oportuna.
     * Recuerda serenamente no automedicarse antes de que el equipo médico lo evalúe.

4. TONO AMIGABLE SIN CREAR DEPENDENCIA:
   - Sé respetuoso, amable y cercano, manteniendo siempre el rol de una herramienta de consulta digital orientativa.
   - Evita lenguaje de apego o dependencia emocional (no uses frases como "yo siempre estaré aquí para cuidarte" ni asumas roles de confidente íntimo).
   - Fomenta siempre la confianza y la comunicación del paciente con su oncólogo, equipo de enfermería y su red de apoyo familiar.

5. CORTESÍAS Y SALUDOS:
   - Si el mensaje es un saludo o agradecimiento ("hola", "gracias"), responde con una frase breve, amigable y discreta, con 'estado_respuesta: "cortesia"' y 'requiere_urgencia: false'.
`;

export interface ValidatedGeminiPayload {
  respuesta: string;
  requiere_urgencia: boolean;
  estado_respuesta: 'respuesta' | 'sin_informacion' | 'cortesia';
}

export function validateGeminiPayload(raw: unknown): ValidatedGeminiPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('La respuesta de Gemini no es un objeto JSON válido.');
  }
  const candidate = raw as Record<string, unknown>;

  // 1. Exigir texto no vacío
  if (typeof candidate.respuesta !== 'string') {
    throw new Error('El campo "respuesta" debe ser una cadena de texto.');
  }
  const respuesta = candidate.respuesta.trim();
  if (!respuesta) {
    throw new Error('El campo "respuesta" no puede estar vacío.');
  }

  // 2. Exigir booleano real estricto (rechazar cadenas "false" o números)
  if (typeof candidate.requiere_urgencia !== 'boolean') {
    throw new Error('El campo "requiere_urgencia" debe ser un booleano estricto.');
  }

  // 3. Exigir estado estrictamente permitido
  if (
    typeof candidate.estado_respuesta !== 'string' ||
    !['respuesta', 'sin_informacion', 'cortesia'].includes(candidate.estado_respuesta)
  ) {
    throw new Error(
      `El campo "estado_respuesta" contiene un valor no permitido: "${String(candidate.estado_respuesta)}".`,
    );
  }

  return {
    respuesta,
    requiere_urgencia: candidate.requiere_urgencia,
    estado_respuesta: candidate.estado_respuesta as 'respuesta' | 'sin_informacion' | 'cortesia',
  };
}

export interface GeminiClientOptions {
  apiKey: string;
  timeoutMs?: number;
}

export class GeminiAssistantClient {
  private readonly ai: GoogleGenAI;
  readonly totalBudgetMs: number;

  constructor(options: GeminiClientOptions) {
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
    this.totalBudgetMs = options.timeoutMs ?? 22000;
  }

  async ask(
    message: string,
    activarAlarmas = true,
    includeDebug = false,
    requestId?: string,
  ): Promise<AiChatResponse> {
    const startTime = Date.now();
    const overallController = new AbortController();
    const overallTimer = setTimeout(() => overallController.abort(), this.totalBudgetMs);

    const is503Error = (error: unknown): boolean => {
      if (!error) return false;
      const str = error instanceof Error ? error.message : String(error);
      const status = (error as { status?: number }).status;
      return status === 503 || /503|UNAVAILABLE/i.test(str);
    };

    const sleepWithSignal = (ms: number, signal: AbortSignal): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          return reject(new Error('Petición cancelada antes del reintento.'));
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(new Error('Petición cancelada durante el intervalo de espera.'));
        };
        signal.addEventListener('abort', onAbort);
      });
    };

    try {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const elapsed = Date.now() - startTime;
        const remainingBudget = this.totalBudgetMs - elapsed;
        if (remainingBudget <= 0 || overallController.signal.aborted) {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }

        const attemptController = new AbortController();
        const onOverallAbort = () => attemptController.abort();
        overallController.signal.addEventListener('abort', onOverallAbort);

        const attemptTimeout = Math.max(1, Math.min(10000, remainingBudget));
        const attemptTimer = setTimeout(() => attemptController.abort(), attemptTimeout);

        try {
          if (attempt > 1) {
            console.log(
              `[qc-ai] (solicitud_id: ${requestId ?? 'sin-id'}) Reintento 2 tras 503 UNAVAILABLE`,
            );
          }
          const response = await this.ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: message,
            config: {
              systemInstruction: ONCOLOGY_SYSTEM_PROMPT,
              abortSignal: attemptController.signal,
              httpOptions: { timeout: attemptTimeout },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  respuesta: {
                    type: Type.STRING,
                    description: 'Respuesta empática, comprensible y orientativa para el paciente.',
                  },
                  requiere_urgencia: {
                    type: Type.BOOLEAN,
                    description:
                      'true si el paciente describe síntomas de alarma (fiebre >= 38°C, sangrado, disnea, vómitos incoercibles), false en caso contrario.',
                  },
                  estado_respuesta: {
                    type: Type.STRING,
                    description:
                      'Estado: respuesta (información clínica útil), sin_informacion (fuera de dominio), cortesia (saludo/despedida).',
                  },
                },
                required: ['respuesta', 'requiere_urgencia', 'estado_respuesta'],
              },
            },
          });

          const text = response.text;
          if (!text || !text.trim()) {
            throw new Error('Gemini API devolvió una respuesta vacía.');
          }

          let rawParsed: unknown;
          try {
            rawParsed = JSON.parse(text);
          } catch (parseError) {
            throw new Error(
              `Error al parsear JSON de Gemini: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
              { cause: parseError },
            );
          }

          const validated = validateGeminiPayload(rawParsed);
          const requiereUrgencia = activarAlarmas && validated.requiere_urgencia;

          return {
            respuesta: validated.respuesta,
            fuentes: [],
            requiere_urgencia: requiereUrgencia,
            confianza_nivel:
              requiereUrgencia || validated.estado_respuesta !== 'respuesta'
                ? 'ninguna'
                : 'no_verificada',
            estado_respuesta: validated.estado_respuesta,
            debug: includeDebug
              ? {
                  origen: 'gemini-api',
                  modelo: GEMINI_MODEL,
                  confianza_score: 0,
                  confianza_razon: 'Generación directa vía prompt sin RAG documentado',
                  motivos_alarma: requiereUrgencia ? ['alerta_clinica_gemini'] : [],
                  keywords: [],
                  temas: [],
                  tokens_prompt: response.usageMetadata?.promptTokenCount ?? 0,
                  tokens_respuesta: response.usageMetadata?.candidatesTokenCount ?? 0,
                  ms_busqueda: 0,
                  ms_llm: Date.now() - startTime,
                }
              : null,
          };
        } catch (error) {
          lastError = error;
          if (overallController.signal.aborted || attemptController.signal.aborted) {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
          }
          if (attempt === 1 && is503Error(error) && !overallController.signal.aborted) {
            const jitter = Math.floor(Math.random() * 400) + 800; // 800ms - 1200ms
            const remainingForSleep = this.totalBudgetMs - (Date.now() - startTime);
            if (remainingForSleep > jitter) {
              await sleepWithSignal(jitter, overallController.signal);
              continue;
            }
          }
          throw error;
        } finally {
          clearTimeout(attemptTimer);
          overallController.signal.removeEventListener('abort', onOverallAbort);
        }
      }
      throw lastError ?? new Error('Fallo de invocación a Gemini.');
    } finally {
      clearTimeout(overallTimer);
    }
  }
}
