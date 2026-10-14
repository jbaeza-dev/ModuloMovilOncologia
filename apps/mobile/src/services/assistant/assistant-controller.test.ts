import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantController } from './assistant-controller';
import { FakeAssistantAdapter } from './fake-assistant-adapter';
import { UnconfiguredAssistantAdapter } from './unconfigured-assistant-adapter';

describe('AssistantController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ciclo de vida completo de envío y recepción', async () => {
    const adapter = new FakeAssistantAdapter({ simulatedDelayMs: 50 });
    const controller = new AssistantController(adapter, 'paciente-a');

    expect(controller.getState()).toBe('idle');
    expect(controller.getMessages()).toHaveLength(0);

    const sendPromise = controller.send('¿Qué hago si tengo náuseas?');
    expect(controller.getState()).toBe('sending');
    expect(controller.getMessages()).toHaveLength(1);
    expect(controller.getMessages()[0].sender).toBe('user');

    await vi.advanceTimersByTimeAsync(100);
    await sendPromise;

    expect(controller.getState()).toBe('response');
    expect(controller.getMessages()).toHaveLength(2);
    expect(controller.getMessages()[1].sender).toBe('assistant');
    expect(controller.getMessages()[1].text).toContain('náuseas');
  });

  it('prevención estricta de doble pulsación durante sending', async () => {
    const adapter = new FakeAssistantAdapter({ simulatedDelayMs: 200 });
    const controller = new AssistantController(adapter, 'paciente-a');

    const firstSend = controller.send('primera consulta');
    expect(controller.getState()).toBe('sending');

    // Segundo envío simultáneo debe ser ignorado
    await controller.send('segunda consulta');
    expect(controller.getMessages()).toHaveLength(1);
    expect(controller.getMessages()[0].text).toBe('primera consulta');

    await vi.advanceTimersByTimeAsync(250);
    await firstSend;

    expect(controller.getState()).toBe('response');
    expect(controller.getMessages()).toHaveLength(2);
  });

  it('cancelación manual con abort() y descarte de respuestas si el adaptador ignora signal', async () => {
    const adapter = new FakeAssistantAdapter({
      simulatedDelayMs: 500,
      ignoreAbortSignal: true,
    });
    const controller = new AssistantController(adapter, 'paciente-a');

    const sendPromise = controller.send('consulta que será cancelada');
    expect(controller.getState()).toBe('sending');

    // Abortar manualmente a los 100ms
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect(controller.getState()).toBe('cancelled');

    // Completar el tiempo original del adaptador (ignora abort)
    await vi.advanceTimersByTimeAsync(500);
    await sendPromise;

    // El estado debe permanecer en cancelled y no pasar a response
    expect(controller.getState()).toBe('cancelled');
    // Solo el mensaje del usuario está presente
    expect(controller.getMessages()).toHaveLength(1);
    expect(controller.getMessages()[0].sender).toBe('user');
  });

  it('timeout a los 15 s distinguiéndose de falta de red y descartando respuestas tardías', async () => {
    const adapter = new FakeAssistantAdapter({
      simulatedDelayMs: 20000,
      ignoreAbortSignal: true,
    });
    const controller = new AssistantController(adapter, 'paciente-a');

    const sendPromise = controller.send('consulta con timeout');
    expect(controller.getState()).toBe('sending');

    // Avanzar a 14.9s: aún en sending
    await vi.advanceTimersByTimeAsync(14900);
    expect(controller.getState()).toBe('sending');

    // Avanzar a 15s: salta el timeout
    await vi.advanceTimersByTimeAsync(200);
    expect(controller.getState()).toBe('timeout');

    // Permitir que el adaptador complete su promesa tardía a los 20s
    await vi.advanceTimersByTimeAsync(6000);
    await sendPromise;

    // Estado sigue en timeout
    expect(controller.getState()).toBe('timeout');
    expect(controller.getMessages()).toHaveLength(1);
  });

  it('si el abort por timeout dispara el catch por rechazo nativo, el estado se preserva en timeout y no cancelled', async () => {
    // FakeAssistantAdapter lanza AbortError cuando signal se aborta
    const adapter = new FakeAssistantAdapter({ simulatedDelayMs: 20000 });
    const controller = new AssistantController(adapter, 'paciente-a');

    const sendPromise = controller.send('consulta que abortará por timeout');
    expect(controller.getState()).toBe('sending');

    // Avanzar a los 15 segundos: salta el timer de timeout y aborta el controller
    await vi.advanceTimersByTimeAsync(15100);
    await sendPromise;

    // Aunque el adaptador rechazó con AbortError, el controlador mantiene 'timeout'
    expect(controller.getState()).toBe('timeout');
  });

  it('cancelar e iniciar nueva consulta no aborta el nuevo intento por temporizadores residuales', async () => {
    const adapter = new FakeAssistantAdapter({ simulatedDelayMs: 200 });
    const controller = new AssistantController(adapter, 'paciente-a');

    // Intento 1
    const send1 = controller.send('consulta 1');
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect(controller.getState()).toBe('cancelled');
    await send1;

    // Intento 2 después de 5 segundos
    await vi.advanceTimersByTimeAsync(5000);
    const send2 = controller.send('consulta 2');
    expect(controller.getState()).toBe('sending');

    // Avanzar 10 segundos más (habrán pasado 15s desde el inicio de intento 1)
    await vi.advanceTimersByTimeAsync(100);
    // El intento 2 debe resolverse normalmente y no ser abortado
    await vi.advanceTimersByTimeAsync(200);
    await send2;

    expect(controller.getState()).toBe('response');
  });

  it('reintento manual: si el texto es idéntico, preserva requestId; si cambia, genera nuevo UUID', async () => {
    const adapter = new FakeAssistantAdapter({ simulatedDelayMs: 50 });
    let idCounter = 1;
    const newId = () => `uuid-${idCounter++}`;
    const controller = new AssistantController(adapter, 'paciente-a', undefined, newId);

    // Envío inicial
    const send1 = controller.send('consulta para reintento');
    const firstReqId = controller.getLastRequestId();
    expect(firstReqId).toBe('uuid-1');
    await vi.advanceTimersByTimeAsync(100);
    await send1;

    // Reintento manual con mismo texto
    const sendRetry = controller.send('consulta para reintento', true);
    expect(controller.getLastRequestId()).toBe(firstReqId);
    await vi.advanceTimersByTimeAsync(100);
    await sendRetry;

    // Reintento manual con texto modificado: nuevo requestId
    const sendModified = controller.send('consulta para reintento MODIFICADA', true);
    expect(controller.getLastRequestId()).not.toBe(firstReqId);
    await vi.advanceTimersByTimeAsync(100);
    await sendModified;
  });

  it('aislamiento A -> B -> A: una respuesta tardía de A no llega al segundo contexto de A por cambio de época', async () => {
    const adapter = new FakeAssistantAdapter({
      simulatedDelayMs: 1000,
      ignoreAbortSignal: true,
    });
    const controller = new AssistantController(adapter, 'paciente-a');

    // Paciente A envía en época 0
    controller.setContext('paciente-a', 0);
    const sendA1 = controller.send('pregunta de A en epoca 0');
    expect(controller.getMessages()).toHaveLength(1);

    // A los 200ms se cambia de contexto a Paciente B (época 1)
    await vi.advanceTimersByTimeAsync(200);
    controller.setContext('paciente-b', 1);
    expect(controller.getMessages()).toHaveLength(0);
    expect(controller.getState()).toBe('idle');

    // Se cambia de vuelta a Paciente A (época 2)
    controller.setContext('paciente-a', 2);
    expect(controller.getMessages()).toHaveLength(0);

    // Concluye la promesa tardía de A en época 0
    await vi.advanceTimersByTimeAsync(1000);
    await sendA1;

    // La respuesta de la época 0 debe ser descartada y no aparecer en el nuevo contexto
    expect(controller.getMessages()).toHaveLength(0);
    expect(controller.getState()).toBe('idle');
  });

  it('mapeo de not_configured verificado hacia el estado específico', async () => {
    const adapter = new UnconfiguredAssistantAdapter();
    const controller = new AssistantController(adapter, 'paciente-a');

    await controller.send('consulta en entorno no configurado');
    expect(controller.getState()).toBe('not_configured');
  });

  it('mapeo de network_offline hacia el estado offline', async () => {
    const adapter = new FakeAssistantAdapter({ shouldSimulateOffline: true });
    const controller = new AssistantController(adapter, 'paciente-a');

    await controller.send('consulta sin conexión');
    expect(controller.getState()).toBe('offline');
  });

  it('límite de 2.000 caracteres: rechaza consultas excesivas y admite hasta 2.000', async () => {
    const adapter = new FakeAssistantAdapter({ simulatedDelayMs: 50 });
    const controller = new AssistantController(adapter, 'paciente-a');

    // 2001 caracteres
    const longText = 'a'.repeat(2001);
    await controller.send(longText);
    expect(controller.getState()).toBe('idle');
    expect(controller.getMessages()).toHaveLength(0);

    // Texto vacío o solo espacios
    await controller.send('    ');
    expect(controller.getState()).toBe('idle');
    expect(controller.getMessages()).toHaveLength(0);

    // Exactamente 2.000 caracteres
    const validLongText = 'a'.repeat(2000);
    const sendPromise = controller.send(validLongText);
    expect(controller.getState()).toBe('sending');
    await vi.advanceTimersByTimeAsync(100);
    await sendPromise;
    expect(controller.getState()).toBe('response');
  });

  it('transición por session_required invoca onSessionRequired y establece estado', async () => {
    const adapter = new FakeAssistantAdapter({ shouldSimulateSessionRequired: true });
    const onSessionRequired = vi.fn();
    const controller = new AssistantController(adapter, 'paciente-a', onSessionRequired);

    await controller.send('consulta con sesión expirada');
    expect(controller.getState()).toBe('session_required');
    expect(onSessionRequired).toHaveBeenCalledTimes(1);
  });

  it('buffer en memoria FIFO retiene un máximo de 50 mensajes', async () => {
    const adapter = new FakeAssistantAdapter({ simulatedDelayMs: 1 });
    const controller = new AssistantController(adapter, 'paciente-a');

    // Enviar 30 pares de mensajes (60 mensajes en total: 30 user + 30 assistant)
    for (let i = 0; i < 30; i++) {
      const p = controller.send(`mensaje ${i}`);
      await vi.advanceTimersByTimeAsync(10);
      await p;
    }

    expect(controller.getMessages().length).toBe(50);
  });
});
