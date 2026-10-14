import type { AssistantResponse, SendMessageOptions } from './assistant-types';

export interface AssistantAdapter {
  readonly isConfigured: boolean;
  sendMessage(text: string, options: SendMessageOptions): Promise<AssistantResponse>;
}
