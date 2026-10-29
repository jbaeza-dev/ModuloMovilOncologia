import { describe, expect, it, vi } from 'vitest';
import { HttpAssistantAdapter, parseAssistantResponse } from './http-assistant-adapter';
import { AssistantFailure } from './assistant-types';
import { SessionFailure } from '../session/http-session-types';

const owner = '964d32f1-6941-579f-9f08-b60342194da9';
const response = {
  respuesta: 'Respuesta sintética',
  fuentes: [{ tema_id: 'tema', tema: 'Fuente sintética', guia: 1 }],
  requiere_urgencia: false,
  confianza_nivel: 'baja',
  estado_respuesta: 'respuesta',
  debug: null,
};
function harness() {
  let current: string | null = owner;
  const context = new AbortController();
  const request = vi.fn(async () => ({ status: 200, body: response }));
  const session = {
    getCurrentUser: () => (current ? { id: current, name: 'Prueba', isDemo: true } : null),
    getContextSignal: () => context.signal,
    request,
  };
  return {
    adapter: new HttpAssistantAdapter(session),
    request,
    context,
    change: (value: string | null) => {
      current = value;
    },
  };
}
const options = () => ({
  requestId: 'peticion-local',
  patientId: owner,
  signal: new AbortController().signal,
});
describe('Asistente HTTP sin historial ni identificadores clínicos', () => {
  it('envía solo mensaje/activar_alarmas y conserva todos los campos de respuesta', async () => {
    const h = harness(),
      input = options(),
      actual = await h.adapter.sendMessage('consulta', input);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.request).toHaveBeenCalledWith(
      'gateway',
      '/api/gateway/chatbot/consulta',
      'POST',
      { mensaje: 'consulta', activar_alarmas: true },
      {
        signal: input.signal,
        timeoutMs: 75000,
        retryUnauthorized: false,
        preserveServiceErrors: true,
      },
    );
    expect(actual.response).toEqual(response);
    expect(actual.replyText).toBe(response.respuesta);
  });
  it.each(['respuesta', 'sin_informacion', 'cortesia', 'no_disponible'])(
    'conserva estado %s, fuentes y urgencia independientemente',
    async (state) => {
      const h = harness();
      h.request.mockResolvedValue({
        status: 200,
        body: { ...response, estado_respuesta: state, requiere_urgencia: true },
      });
      expect((await h.adapter.sendMessage('consulta', options())).response).toMatchObject({
        estado_respuesta: state,
        requiere_urgencia: true,
        fuentes: response.fuentes,
      });
    },
  );
  it('conserva detail de un error y no reintenta automáticamente', async () => {
    const h = harness(),
      detail = { detail: 'Servicio temporalmente no disponible.' };
    h.request.mockResolvedValue({ status: 503, body: detail as unknown as typeof response });
    await expect(h.adapter.sendMessage('consulta', options())).rejects.toMatchObject({
      code: 'server_error',
      status: 503,
      body: detail,
    });
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it('descarta una respuesta de A cuando la cuenta cambia a B', async () => {
    const h = harness();
    let finish!: () => void;
    h.request.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { status: 200, body: response };
    });
    const pending = h.adapter.sendMessage('consulta', options());
    h.change('2dcb04f2-a2ad-5ea4-b711-9acd7e570002');
    finish();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('no envía una consulta cancelada ni permite respuestas mal tipadas', async () => {
    const h = harness(),
      c = new AbortController();
    c.abort();
    await expect(
      h.adapter.sendMessage('consulta', { ...options(), signal: c.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.request).not.toHaveBeenCalled();
    expect(() => parseAssistantResponse({ ...response, requiere_urgencia: 'true' })).toThrow(
      AssistantFailure,
    );
    expect(() => parseAssistantResponse({ ...response, debug: {} })).toThrow(AssistantFailure);
  });
  it('distingue timeout de transporte de una falta de red', async () => {
    const h = harness();
    h.request.mockRejectedValue(new SessionFailure('unavailable', 408));
    await expect(h.adapter.sendMessage('consulta', options())).rejects.toMatchObject({
      code: 'timeout',
    });
    h.request.mockRejectedValue(new SessionFailure('unavailable'));
    await expect(h.adapter.sendMessage('consulta', options())).rejects.toMatchObject({
      code: 'network_offline',
    });
  });
});
