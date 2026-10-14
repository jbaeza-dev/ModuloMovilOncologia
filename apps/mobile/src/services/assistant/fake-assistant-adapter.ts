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
    const lower = query.toLowerCase();
    if (lower.includes('fiebre') || lower.includes('temperatura')) {
      return 'La fiebre durante la quimioterapia (38 °C o más) es una señal que requiere comunicación inmediata con tu equipo médico o servicio de urgencia oncológica.';
    }
    if (lower.includes('nausea') || lower.includes('náusea') || lower.includes('vómito')) {
      return 'Para el manejo de náuseas, es recomendable ingerir comidas pequeñas y frecuentes, evitar alimentos muy grasos o condimentados y tomar la medicación antiemética indicada por tu equipo.';
    }
    if (lower.includes('fatiga') || lower.includes('cansancio')) {
      return 'La fatiga es uno de los síntomas más habituales en quimioterapia. Intenta intercalar periodos de descanso con caminatas breves y mantén una buena hidratación.';
    }
    return 'Comprendo tu consulta. Esta es una orientación general demostrativa del módulo móvil de QuimioCare. Ante cualquier duda o síntoma persistente, consulta directamente a tu equipo tratante.';
  }
}
