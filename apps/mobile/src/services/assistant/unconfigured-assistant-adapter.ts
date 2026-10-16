import type { AssistantAdapter } from './assistant-adapter';
import type { AssistantResponse, SendMessageOptions } from './assistant-types';

export class UnconfiguredAssistantAdapter implements AssistantAdapter {
  readonly isConfigured = false;

  async sendMessage(text: string, options: SendMessageOptions): Promise<AssistantResponse> {
    void text;
    void options;
    const err = new Error('El servicio del asistente no está configurado en este entorno.');
    (err as { code?: string }).code = 'not_configured';
    throw err;
  }
}
