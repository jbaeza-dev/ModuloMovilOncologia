import { GoogleGenAI, Type } from '@google/genai';
import type { AiChatResponse, AiFuenteItem } from '@quimiocare/contracts';

export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

export const ONCOLOGY_SYSTEM_PROMPT = `Eres el Asistente Clínico de QuimioCare, una herramienta digital de apoyo y orientación educativa para pacientes en tratamiento de quimioterapia.

Tus pautas de comunicación son:
1. BREVEDAD Y CLARIDAD:
   - Entrega respuestas breves, estructuradas y fáciles de leer en un dispositivo móvil (idealmente de 1 a 2 párrafos cortos o puntos clave).
   - Ve directo al grano con pautas prácticas y sencillas, evitando textos largos o rodeos innecesarios.

2. DELIMITACIÓN Y MARGEN DEL CONTEXTO:
   - Mantén tus respuestas estrictamente dentro del ámbito de la educación oncológica, autocuidado, alivio de síntomas comunes y bienestar durante la quimioterapia.
   - No formules diagnósticos, no prescribas fármacos ni modifiques dosis médicas. Si te consultan por temas ajenos al tratamiento, responde de forma breve y cortés que está fuera del alcance de la guía.

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

5. FUENTES SUGERIDAS:
   - En el campo 'fuentes', lista brevemente los temas educativos relacionados (ej. Alimentación, Náuseas, Cuidado bucal, Hidratación).

6. CORTESÍAS Y SALUDOS:
   - Si el mensaje es un saludo o agradecimiento ("hola", "gracias"), responde con una frase breve, amigable y discreta, con 'estado_respuesta: "cortesia"' y 'requiere_urgencia: false'.
`;

export interface GeminiClientOptions {
  apiKey: string;
  timeoutMs?: number;
}

export class GeminiAssistantClient {
  private readonly ai: GoogleGenAI;
  private readonly timeoutMs: number;

  constructor(options: GeminiClientOptions) {
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async ask(message: string, activarAlarmas = true): Promise<AiChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: message,
        config: {
          systemInstruction: ONCOLOGY_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              respuesta: {
                type: Type.STRING,
                description: 'Respuesta empática, comprensible y orientativa para el paciente.',
              },
              fuentes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tema_id: { type: Type.STRING },
                    guia: { type: Type.INTEGER },
                    tema: { type: Type.STRING },
                  },
                  required: ['tema_id', 'guia', 'tema'],
                },
                description: 'Temas o guías educativas sugeridas de acuerdo con la consulta.',
              },
              requiere_urgencia: {
                type: Type.BOOLEAN,
                description:
                  'true si el paciente describe síntomas de alarma (fiebre >= 38°C, sangrado, disnea, vómitos incoercibles), false en caso contrario.',
              },
              confianza_nivel: {
                type: Type.STRING,
                description: 'Nivel de confianza: alta, media, baja o ninguna.',
              },
              estado_respuesta: {
                type: Type.STRING,
                description:
                  'Estado: respuesta (información clínica útil), sin_informacion (fuera de dominio), cortesia (saludo/despedida), no_disponible (falla o restricción).',
              },
            },
            required: [
              'respuesta',
              'fuentes',
              'requiere_urgencia',
              'confianza_nivel',
              'estado_respuesta',
            ],
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Gemini API devolvió una respuesta vacía.');
      }

      const parsed = JSON.parse(text) as {
        respuesta?: string;
        fuentes?: AiFuenteItem[];
        requiere_urgencia?: boolean;
        confianza_nivel?: string;
        estado_respuesta?: string;
      };

      const requiereUrgencia = activarAlarmas && Boolean(parsed.requiere_urgencia);
      const estadoRespuesta = (
        ['respuesta', 'sin_informacion', 'cortesia', 'no_disponible'].includes(
          parsed.estado_respuesta ?? '',
        )
          ? parsed.estado_respuesta
          : 'respuesta'
      ) as AiChatResponse['estado_respuesta'];

      return {
        respuesta: String(parsed.respuesta ?? '').trim() || 'No se pudo generar una respuesta.',
        fuentes: Array.isArray(parsed.fuentes) ? parsed.fuentes : [],
        requiere_urgencia: requiereUrgencia,
        confianza_nivel: String(parsed.confianza_nivel ?? 'media'),
        estado_respuesta: estadoRespuesta,
        debug: {
          origen: 'gemini-api',
          modelo: GEMINI_MODEL,
          confianza_score: requiereUrgencia ? 0.99 : 0.85,
          confianza_razon: requiereUrgencia
            ? 'Síntoma de alarma detectado por Gemini'
            : 'Orientación oncológica generada con éxito',
          motivos_alarma: requiereUrgencia ? ['alerta_clinica_gemini'] : [],
          keywords: [],
          temas: (parsed.fuentes ?? []).map((f) => f.tema),
          tokens_prompt: 0,
          tokens_respuesta: 0,
          ms_busqueda: 0,
          ms_llm: 0,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
