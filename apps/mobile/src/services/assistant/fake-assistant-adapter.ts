import type { AssistantAdapter } from './assistant-adapter';
import type { AssistantResponse, SendMessageOptions } from './assistant-types';

export interface FakeAssistantOptions {
  simulatedDelayMs?: number;
  shouldSimulateOffline?: boolean;
  shouldSimulateTimeout?: boolean;
  shouldSimulateSessionRequired?: boolean;
  ignoreAbortSignal?: boolean;
  customReply?: string;
}

export class FakeAssistantAdapter implements AssistantAdapter {
  readonly isConfigured = true;

  constructor(private options: FakeAssistantOptions = {}) {}

  setOptions(options: Partial<FakeAssistantOptions>): void {
    this.options = { ...this.options, ...options };
  }

  async sendMessage(text: string, options: SendMessageOptions): Promise<AssistantResponse> {
    const { signal, requestId } = options;

    if (signal?.aborted && !this.options.ignoreAbortSignal) {
      const abortErr = new Error('Operación cancelada');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    if (this.options.shouldSimulateOffline) {
      const err = new Error('No hay conexión con el servicio del asistente');
      (err as { code?: string }).code = 'network_offline';
      throw err;
    }

    if (this.options.shouldSimulateSessionRequired) {
      const err = new Error('La sesión de usuario ha expirado');
      (err as { code?: string }).code = 'session_required';
      throw err;
    }

    const delay = this.options.shouldSimulateTimeout
      ? 25000
      : (this.options.simulatedDelayMs ?? 100);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (signal && !this.options.ignoreAbortSignal) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      }, delay);

      const onAbort = () => {
        clearTimeout(timer);
        const abortErr = new Error('Operación cancelada');
        abortErr.name = 'AbortError';
        reject(abortErr);
      };

      if (signal && !this.options.ignoreAbortSignal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    if (signal?.aborted && !this.options.ignoreAbortSignal) {
      const abortErr = new Error('Operación cancelada');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const replyText = this.options.customReply ?? this.generateSyntheticResponse(text);

    return {
      replyText,
      isDemo: true,
      requestId,
    };
  }

  private generateSyntheticResponse(query: string): string {
    const clean = query.trim();
    return `[Demostración técnica] He recibido tu consulta ("${clean}"). Esta es una respuesta sintética simulada del asistente para evaluar la interfaz y el flujo de mensajes en modo demostración. No constituye orientación clínica ni asesoramiento médico. Ante dudas sobre tu salud o síntomas persistentes, consulta directamente a tu equipo médico tratante.`;
  }
}
