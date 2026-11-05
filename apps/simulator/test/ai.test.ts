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
  it('detecta cortesías y responde con estado cortesia', () => {
    const res = aiResponse(defaultState, 'Hola!');
    expect(res.estado_respuesta).toBe('cortesia');
    expect(res.requiere_urgencia).toBe(false);
  });

  it('respeta escenario IA_URGENCIA', () => {
    const res = aiResponse({ ...defaultState, escenario: 'IA_URGENCIA' }, '¿Qué hago con náuseas?');
    expect(res.requiere_urgencia).toBe(true);
    expect(res.estado_respuesta).toBe('no_disponible');
  });

  it('respeta escenario IA_NO_DISPONIBLE', () => {
    const res = aiResponse({ ...defaultState, escenario: 'IA_NO_DISPONIBLE' }, 'Consulta médica');
    expect(res.estado_respuesta).toBe('no_disponible');
  });

  it('devuelve respuesta sintética por defecto sin API key', () => {
    const res = aiResponse(defaultState, '¿Puedo tomar té de manzanilla?');
    expect(res.estado_respuesta).toBe('respuesta');
    expect(res.requiere_urgencia).toBe(false);
  });
});

describe('executeAiChat integration and fallback', () => {
  it('aplica fallback determinista si config.geminiApiKey no está configurada', async () => {
    const res = await executeAiChat(config, defaultState, 'Hola');
    expect(res.estado_respuesta).toBe('cortesia');
  });

  it('delega en GeminiAssistantClient si config.geminiApiKey existe', async () => {
    const configWithGemini = { ...config, geminiApiKey: 'mock-key' };
    const askSpy = vi.spyOn(GeminiAssistantClient.prototype, 'ask').mockResolvedValueOnce({
      respuesta: 'Recomendación oncológica de Gemini.',
      fuentes: [{ tema_id: 'nutricion', guia: 1, tema: 'Alimentación e hidratación' }],
      requiere_urgencia: false,
      confianza_nivel: 'alta',
      estado_respuesta: 'respuesta',
      debug: null,
    });

    const res = await executeAiChat(
      configWithGemini,
      defaultState,
      '¿Qué puedo comer si tengo náuseas?',
    );
    expect(askSpy).toHaveBeenCalledWith('¿Qué puedo comer si tengo náuseas?', true);
    expect(res.respuesta).toBe('Recomendación oncológica de Gemini.');
    expect(res.fuentes).toHaveLength(1);
    expect(res.confianza_nivel).toBe('alta');
  });

  it('aplica fallback gracefully ante fallo de red o cuota de Gemini API', async () => {
    const configWithGemini = { ...config, geminiApiKey: 'mock-key' };
    vi.spyOn(GeminiAssistantClient.prototype, 'ask').mockRejectedValueOnce(
      new Error('Rate limit exceeded: 429 Too Many Requests'),
    );

    const res = await executeAiChat(
      configWithGemini,
      defaultState,
      '¿Qué puedo comer si tengo náuseas?',
    );
    expect(res.estado_respuesta).toBe('respuesta');
    expect(res.debug?.origen).toBe('gemini-fallback');
    expect(res.debug?.confianza_razon).toContain('Rate limit exceeded');
  });
});
