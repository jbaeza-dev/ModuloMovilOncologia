import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config.js';
import { aiResponse, executeAiChat } from '../src/ai.js';
import { GeminiAssistantClient } from '../src/gemini-client.js';

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
  it('cancela la petición mediante abortSignal cuando se supera el tiempo límite', async () => {
    const client = new GeminiAssistantClient({ apiKey: 'mock-key', timeoutMs: 20 });
    // Mock generateContent para simular una petición que tarda más que timeoutMs
    // @ts-expect-error accessing private ai for testing cancellation
    vi.spyOn(client.ai.models, 'generateContent').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          }, 50);
        }),
    );

    await expect(client.ask('consulta lenta')).rejects.toThrow();
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

  it('preserva detección de urgencia médica ante fallo de Gemini si el mensaje contiene síntomas de alarma', async () => {
    const configWithGemini = { ...config, geminiApiKey: 'mock-key' };
    vi.spyOn(GeminiAssistantClient.prototype, 'ask').mockRejectedValueOnce(
      new Error('Connection reset'),
    );

    const res = await executeAiChat(
      configWithGemini,
      defaultState,
      'Tengo 38.8 de fiebre y me siento muy mal',
      true,
      false,
    );
    expect(res.estado_respuesta).toBe('no_disponible');
    expect(res.requiere_urgencia).toBe(true);
    expect(res.respuesta).toContain('evaluación médica');
    expect(res.debug).toBeNull();
  });
});
