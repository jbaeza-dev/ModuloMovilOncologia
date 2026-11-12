import { describe, expect, it, vi } from 'vitest';
import { GeminiAssistantClient } from '../src/gemini-client.js';

function cliente(respuesta: unknown, timeoutMs = 5000) {
  const client = new GeminiAssistantClient({ apiKey: 'mock-key', timeoutMs });
  // @ts-expect-error acceso al cliente interno para simular la API
  vi.spyOn(client.ai.models, 'generateContent').mockResolvedValue(respuesta);
  return client;
}
const valido = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    respuesta: 'Texto sintético.',
    requiere_urgencia: false,
    estado_respuesta: 'respuesta',
    ...over,
  });

describe('GeminiAssistantClient: interpretación de respuestas', () => {
  it('rechaza una respuesta vacía', async () => {
    await expect(cliente({ text: '   ' }).ask('consulta')).rejects.toThrow('respuesta vacía');
    await expect(cliente({}).ask('consulta')).rejects.toThrow('respuesta vacía');
  });

  it('rechaza un JSON inválido indicando la causa', async () => {
    await expect(cliente({ text: '{no-json' }).ask('consulta')).rejects.toThrow(
      'Error al parsear JSON de Gemini',
    );
  });

  it('incluye el detalle técnico con tokens y alarma cuando se solicita', async () => {
    const r = await cliente({
      text: valido({ requiere_urgencia: true }),
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
    }).ask('fiebre alta', true, true, 'req-1');
    expect(r.requiere_urgencia).toBe(true);
    expect(r.confianza_nivel).toBe('ninguna');
    expect(r.debug).toMatchObject({
      origen: 'gemini-api',
      tokens_prompt: 12,
      tokens_respuesta: 34,
      motivos_alarma: ['alerta_clinica_gemini'],
    });
  });

  it('sin métricas de uso informa cero tokens y sin alarmas desactiva la urgencia', async () => {
    const r = await cliente({ text: valido({ requiere_urgencia: true }) }).ask(
      'consulta',
      false,
      true,
    );
    expect(r.requiere_urgencia).toBe(false);
    expect(r.debug).toMatchObject({ tokens_prompt: 0, tokens_respuesta: 0, motivos_alarma: [] });
  });

  it('una respuesta fuera de dominio no declara confianza', async () => {
    const r = await cliente({ text: valido({ estado_respuesta: 'sin_informacion' }) }).ask(
      'otra cosa',
    );
    expect(r.confianza_nivel).toBe('ninguna');
    expect(r.debug).toBeNull();
  });

  it('sin presupuesto de tiempo aborta antes de llamar a la API', async () => {
    const client = cliente({ text: valido() }, 0);
    await expect(client.ask('consulta')).rejects.toThrow(/aborted/i);
  });
});
