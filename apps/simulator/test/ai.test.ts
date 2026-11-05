import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config.js';
import { aiResponse, executeAiChat } from '../src/ai.js';
import {
  GeminiAssistantClient,
  validateGeminiPayload,
  type ValidatedGeminiPayload,
} from '../src/gemini-client.js';

const config = readConfig({
  APP_ENV: 'demo',
  DATABASE_URL: 'postgres://synthetic.invalid/demo',
  DEMO_SIGNING_KEY: 'synthetic-unit-test-signing-key-not-production',
  DEMO_CONTROL_KEY: 'synthetic-unit-test-control-key-not-production',
  SIMULATOR_PUBLIC_BASE_URL: 'http://synthetic.invalid',
});

const defaultState = {
  paciente_id: 'paciente-1',
  escenario: 'NORMAL' as const,
  aplicado_en: new Date(),
  generation: 'gen-1',
  session_epoch: 'epoch-1',
  ack_signos_usado: false,
  ack_epro_usado: false,
};

describe('validateGeminiPayload runtime assertions', () => {
  it('acepta un payload estrictamente válido y recorta espacios de la respuesta', () => {
    const raw = {
      respuesta: '   Bebe agua en sorbos pequeños.   ',
      requiere_urgencia: false,
      estado_respuesta: 'respuesta',
    };
    const valid = validateGeminiPayload(raw);
    expect(valid).toEqual<ValidatedGeminiPayload>({
      respuesta: 'Bebe agua en sorbos pequeños.',
      requiere_urgencia: false,
      estado_respuesta: 'respuesta',
    });
  });

  it('rechaza si la respuesta no es un objeto o es un arreglo', () => {
    expect(() => validateGeminiPayload(null)).toThrow(/no es un objeto JSON válido/);
    expect(() => validateGeminiPayload('cadena')).toThrow(/no es un objeto JSON válido/);
    expect(() => validateGeminiPayload([])).toThrow(/no es un objeto JSON válido/);
  });

  it('rechaza respuestas vacías o compuestas únicamente por espacios', () => {
    expect(() =>
      validateGeminiPayload({
        respuesta: '   ',
        requiere_urgencia: false,
        estado_respuesta: 'respuesta',
      }),
    ).toThrow(/no puede estar vacío/);

    expect(() =>
      validateGeminiPayload({
        respuesta: 12345,
        requiere_urgencia: false,
        estado_respuesta: 'respuesta',
      }),
    ).toThrow(/debe ser una cadena de texto/);
  });

  it('rechaza si requiere_urgencia no es un booleano estricto (rechaza "false", 0, etc.)', () => {
    expect(() =>
      validateGeminiPayload({
        respuesta: 'Alimentación suave',
        requiere_urgencia: 'false',
        estado_respuesta: 'respuesta',
      }),
    ).toThrow(/debe ser un booleano estricto/);

    expect(() =>
      validateGeminiPayload({
        respuesta: 'Alimentación suave',
        requiere_urgencia: 0,
        estado_respuesta: 'respuesta',
      }),
    ).toThrow(/debe ser un booleano estricto/);
  });

  it('rechaza si estado_respuesta contiene un valor desconocido o no permitido', () => {
    expect(() =>
      validateGeminiPayload({
        respuesta: 'Alimentación suave',
        requiere_urgencia: false,
        estado_respuesta: 'exitoso',
      }),
    ).toThrow(/valor no permitido/);
  });
});

describe('aiResponse deterministic stub', () => {
  it('detecta cortesías y responde con estado cortesia sin depuración por defecto', () => {
    const res = aiResponse(defaultState, 'Hola!');
    expect(res.estado_respuesta).toBe('cortesia');
    expect(res.requiere_urgencia).toBe(false);
    expect(res.fuentes).toEqual([]);
    expect(res.debug).toBeNull();
  });

  it('respeta escenario IA_URGENCIA', () => {
    const res = aiResponse({ ...defaultState, escenario: 'IA_URGENCIA' }, '¿Qué hago con náuseas?');
    expect(res.requiere_urgencia).toBe(true);
    expect(res.estado_respuesta).toBe('no_disponible');
    expect(res.fuentes).toEqual([]);
  });

  it('respeta escenario IA_NO_DISPONIBLE', () => {
    const res = aiResponse({ ...defaultState, escenario: 'IA_NO_DISPONIBLE' }, 'Consulta médica');
    expect(res.estado_respuesta).toBe('no_disponible');
    expect(res.fuentes).toEqual([]);
  });

  it('incluye objeto debug solo si se solicita explícitamente', () => {
    const res = aiResponse(defaultState, '¿Puedo tomar té?', true);
    expect(res.debug).not.toBeNull();
    expect(res.debug?.origen).toBe('simulator-stub');
  });
});

describe('GeminiAssistantClient abortSignal and cancellation', () => {
  it('cancela efectivamente mediante abortSignal cuando expira el tiempo límite', async () => {
    const client = new GeminiAssistantClient({ apiKey: 'mock-key', timeoutMs: 30 });

    let capturedSignal: AbortSignal | undefined;

    // Mock que inspecciona el abortSignal recibido en config
    // @ts-expect-error accessing private ai for testing cancellation
    vi.spyOn(client.ai.models, 'generateContent').mockImplementation(
      (params: { config?: { abortSignal?: AbortSignal } }) => {
        capturedSignal = params?.config?.abortSignal;

        if (!capturedSignal) {
          // Si no se proveyó abortSignal, la llamada quedaría colgada indefinidamente
          return new Promise(() => {});
        }

        return new Promise((_resolve, reject) => {
          if (capturedSignal?.aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            return reject(err);
          }
          capturedSignal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
    );

    await expect(client.ask('consulta lenta')).rejects.toThrow(/aborted/i);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('completa exitosamente si la respuesta llega antes del tiempo límite', async () => {
    const client = new GeminiAssistantClient({ apiKey: 'mock-key', timeoutMs: 500 });

    // @ts-expect-error accessing private ai for testing fast response
    vi.spyOn(client.ai.models, 'generateContent').mockResolvedValueOnce({
      text: JSON.stringify({
        respuesta: 'Respuesta rápida de prueba.',
        requiere_urgencia: false,
        estado_respuesta: 'respuesta',
      }),
    });

    const res = await client.ask('consulta rápida');
    expect(res.respuesta).toBe('Respuesta rápida de prueba.');
    expect(res.estado_respuesta).toBe('respuesta');
    expect(res.requiere_urgencia).toBe(false);
  });
});

describe('executeAiChat integration and failure handling', () => {
  it('aplica stub de demostración si config.geminiApiKey no está configurada', async () => {
    const res = await executeAiChat(config, defaultState, 'Hola');
    expect(res.estado_respuesta).toBe('cortesia');
    expect(res.fuentes).toEqual([]);
    expect(res.debug).toBeNull();
  });

  it('delega en GeminiAssistantClient si config.geminiApiKey existe, sin inventar fuentes', async () => {
    const configWithGemini = { ...config, geminiApiKey: 'mock-key' };
    const askSpy = vi.spyOn(GeminiAssistantClient.prototype, 'ask').mockResolvedValueOnce({
      respuesta: 'Recomendación oncológica breve y clara.',
      fuentes: [],
      requiere_urgencia: false,
      confianza_nivel: 'no_verificada',
      estado_respuesta: 'respuesta',
      debug: null,
    });

    const res = await executeAiChat(
      configWithGemini,
      defaultState,
      '¿Qué puedo comer si tengo náuseas?',
      true,
      false,
    );
    expect(askSpy).toHaveBeenCalledWith('¿Qué puedo comer si tengo náuseas?', true, false);
    expect(res.respuesta).toBe('Recomendación oncológica breve y clara.');
    expect(res.fuentes).toEqual([]);
    expect(res.confianza_nivel).toBe('no_verificada');
    expect(res.debug).toBeNull();
  });

  it('devuelve estado no_disponible y respeta debug=false ante fallo de red o cuota de Gemini', async () => {
    const configWithGemini = { ...config, geminiApiKey: 'mock-key' };
    vi.spyOn(GeminiAssistantClient.prototype, 'ask').mockRejectedValueOnce(
      new Error('Rate limit exceeded: 429 Too Many Requests'),
    );

    const res = await executeAiChat(
      configWithGemini,
      defaultState,
      '¿Qué puedo comer si tengo náuseas?',
      true,
      false, // debug = false
    );
    expect(res.estado_respuesta).toBe('no_disponible');
    expect(res.fuentes).toEqual([]);
    expect(res.confianza_nivel).toBe('ninguna');
    expect(res.debug).toBeNull(); // No expone mensajes internos del proveedor al paciente
  });

  it('no genera falsas alarmas de urgencia en el manejo de indisponibilidad', async () => {
    const configWithGemini = { ...config, geminiApiKey: 'mock-key' };
    vi.spyOn(GeminiAssistantClient.prototype, 'ask').mockRejectedValue(
      new Error('Proveedor no responde'),
    );

    const res1 = await executeAiChat(
      configWithGemini,
      defaultState,
      '¿Cómo se mide la temperatura?',
      true,
      false,
    );
    expect(res1.estado_respuesta).toBe('no_disponible');
    expect(res1.requiere_urgencia).toBe(false);

    const res2 = await executeAiChat(
      configWithGemini,
      defaultState,
      'No tengo fiebre ni sangrado',
      true,
      false,
    );
    expect(res2.estado_respuesta).toBe('no_disponible');
    expect(res2.requiere_urgencia).toBe(false);
  });

  it('incluye debug con error solo si debug=true ante fallo de Gemini', async () => {
    const configWithGemini = { ...config, geminiApiKey: 'mock-key' };
    vi.spyOn(GeminiAssistantClient.prototype, 'ask').mockRejectedValueOnce(
      new Error('Network timeout'),
    );

    const res = await executeAiChat(
      configWithGemini,
      defaultState,
      '¿Qué puedo comer?',
      true,
      true, // debug = true
    );
    expect(res.estado_respuesta).toBe('no_disponible');
    expect(res.debug).not.toBeNull();
    expect(res.debug?.origen).toBe('gemini-error');
    expect(res.debug?.confianza_razon).toContain('Network timeout');
  });
});
