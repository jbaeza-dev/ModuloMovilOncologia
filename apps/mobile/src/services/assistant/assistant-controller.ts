import type { AssistantAdapter } from './assistant-adapter';
import type {
  AssistantErrorCode,
  AssistantMessage,
  AssistantState,
  AttemptRecord,
} from './assistant-types';
import { AssistantFailure } from './assistant-types';

export class AssistantController {
  private state: AssistantState = 'idle';
  private messages: AssistantMessage[] = [];
  private activeAttempt: AttemptRecord | null = null;
  private attemptGen = 0;
  private contextEpoch = 0;
  private lastSubmittedText: string | null = null;
  private lastRequestId: string | null = null;
  private lastFailure: AssistantFailure | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private adapter: AssistantAdapter,
    private patientId: string | null = null,
    private readonly onSessionRequired?: () => void,
    private readonly newId: () => string = () => {
      if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },
    private readonly timeoutMs = 90000,
  ) {}

  getState(): AssistantState {
    return this.state;
  }

  get isConfigured(): boolean {
    return this.adapter.isConfigured;
  }

  getMessages(): readonly AssistantMessage[] {
    return this.messages;
  }

  getLastSubmittedText(): string | null {
    return this.lastSubmittedText;
  }

  getLastRequestId(): string | null {
    return this.lastRequestId;
  }
  getLastFailure(): AssistantFailure | null {
    return this.lastFailure;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setAdapter(adapter: AssistantAdapter): void {
    this.adapter = adapter;
    this.closeConversation();
  }

  async send(text: string, isRetry = false): Promise<void> {
    // Prevención estricta de doble pulsación
    if (this.state === 'sending' || this.activeAttempt !== null) {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed || Array.from(trimmed).length > 2000) {
      return;
    }

    // Validación estricta de reintento: misma entrada conserva requestId
    let requestId: string;
    if (isRetry && this.lastSubmittedText === trimmed && this.lastRequestId) {
      requestId = this.lastRequestId;
    } else {
      requestId = this.newId();
      this.lastSubmittedText = trimmed;
      this.lastRequestId = requestId;
    }

    // Agregar mensaje del usuario a la memoria si no es un reintento con la misma última burbuja
    const lastMsg = this.messages[this.messages.length - 1];
    if (!(isRetry && lastMsg?.sender === 'user' && lastMsg.text === trimmed)) {
      this.pushMessage({
        id: this.newId(),
        sender: 'user',
        text: trimmed,
        timestamp: new Date().toISOString(),
      });
    }

    this.attemptGen += 1;
    this.lastFailure = null;
    const thisAttemptGen = this.attemptGen;
    const thisEpoch = this.contextEpoch;
    const controller = new AbortController();

    const attempt: AttemptRecord = {
      attemptGen: thisAttemptGen,
      requestId,
      contextEpoch: thisEpoch,
      text: trimmed,
      controller,
      timer: setTimeout(() => {
        if (this.activeAttempt === attempt && !attempt.terminated) {
          attempt.terminated = true;
          attempt.terminationReason = 'timeout';
          attempt.controller.abort();
          this.attemptGen += 1; // Invalida cualquier resolución física posterior
          this.activeAttempt = null;
          this.setState('timeout');
        }
      }, this.timeoutMs),
      terminated: false,
    };

    this.activeAttempt = attempt;
    this.setState('sending');

    try {
      const response = await this.adapter.sendMessage(trimmed, {
        signal: controller.signal,
        requestId,
        patientId: this.patientId,
      });

      clearTimeout(attempt.timer);

      // Comprobación rigurosa: si ya fue terminado por timeout, cancelación o cambio de época, descartar
      if (attempt.terminated || this.activeAttempt !== attempt || this.contextEpoch !== thisEpoch) {
        return;
      }

      attempt.terminated = true;
      attempt.terminationReason = 'completed';
      this.activeAttempt = null;

      this.pushMessage({
        id: this.newId(),
        sender: 'assistant',
        text: response.replyText,
        timestamp: new Date().toISOString(),
        isDemo: response.isDemo,
        ...(response.response ? { response: response.response } : {}),
      });
      this.setState(
        response.response?.estado_respuesta === 'no_disponible' ? 'unavailable' : 'response',
      );
    } catch (err) {
      clearTimeout(attempt.timer);

      // Si el intento ya terminó por timeout o aborto manual previo, NO sobrescribir su estado
      if (attempt.terminated || this.activeAttempt !== attempt || this.contextEpoch !== thisEpoch) {
        return;
      }

      attempt.terminated = true;
      this.activeAttempt = null;
      this.lastFailure = errorOrNull(err);

      if (attempt.controller.signal.aborted) {
        this.setState('cancelled');
        return;
      }

      const code = this.mapErrorCode(err);
      if (code === 'session_required') {
        this.setState('session_required');
        this.onSessionRequired?.();
        return;
      }
      if (code === 'not_configured') {
        this.setState('not_configured');
        return;
      }
      if (code === 'network_offline') {
        this.setState('offline');
        return;
      }
      if (code === 'timeout') {
        this.setState('timeout');
        return;
      }

      this.setState('error');
    }
  }

  abort(): void {
    this.abortCurrentAttempt('cancelled');
    this.setState('cancelled');
  }

  setContext(patientId: string | null, epoch: number): void {
    this.patientId = patientId;
    this.contextEpoch = epoch;
    this.abortCurrentAttempt('epoch_mismatch');
    this.clearMemoryMessages();
    this.lastSubmittedText = null;
    this.lastRequestId = null;
    this.setState('idle');
  }

  clearMemoryMessages(): void {
    this.messages = [];
    this.lastFailure = null;
    this.lastSubmittedText = null;
    this.lastRequestId = null;
    this.notify();
  }
  closeConversation(): void {
    this.abortCurrentAttempt('superseded');
    this.messages = [];
    this.lastFailure = null;
    this.lastSubmittedText = null;
    this.lastRequestId = null;
    this.state = 'idle';
    this.notify();
  }

  private abortCurrentAttempt(reason: 'cancelled' | 'superseded' | 'epoch_mismatch'): void {
    if (this.activeAttempt && !this.activeAttempt.terminated) {
      clearTimeout(this.activeAttempt.timer);
      this.activeAttempt.terminated = true;
      this.activeAttempt.terminationReason = reason;
      this.activeAttempt.controller.abort();
      this.attemptGen += 1;
      this.activeAttempt = null;
    }
  }

  private mapErrorCode(err: unknown): AssistantErrorCode {
    if (err && typeof err === 'object') {
      const code = (err as { code?: string }).code;
      if (code === 'network_offline') return 'network_offline';
      if (code === 'session_required') return 'session_required';
      if (code === 'not_configured') return 'not_configured';
      if (code === 'timeout') return 'timeout';
      if ((err as Error).name === 'AbortError') return 'cancelled';
    }
    return 'server_error';
  }

  private pushMessage(msg: AssistantMessage): void {
    this.messages = [...this.messages, msg];
    if (this.messages.length > 50) {
      this.messages = this.messages.slice(-50);
    }
    this.notify();
  }

  private setState(newState: AssistantState): void {
    this.state = newState;
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Ignorar fallos en listeners individuales
      }
    });
  }
}
function errorOrNull(value: unknown): AssistantFailure | null {
  return value instanceof AssistantFailure ? value : null;
}
