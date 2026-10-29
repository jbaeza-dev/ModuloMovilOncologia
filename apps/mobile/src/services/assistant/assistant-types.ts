import type { AiChatResponse } from '@quimiocare/contracts';

export type AssistantState =
  | 'idle'
  | 'sending'
  | 'response'
  | 'unavailable'
  | 'offline'
  | 'error'
  | 'timeout'
  | 'cancelled'
  | 'session_required'
  | 'not_configured';

export type AssistantErrorCode =
  | 'network_offline'
  | 'timeout'
  | 'session_required'
  | 'not_configured'
  | 'cancelled'
  | 'server_error'
  | 'validation_error';

export interface AssistantMessage {
  readonly id: string;
  readonly sender: 'user' | 'assistant';
  readonly text: string;
  readonly timestamp: string;
  readonly isDemo?: boolean;
  readonly response?: AiChatResponse;
}

export interface SendMessageOptions {
  readonly signal?: AbortSignal;
  readonly requestId: string;
  readonly patientId: string | null;
}

export interface AssistantResponse {
  readonly replyText: string;
  readonly isDemo: boolean;
  readonly requestId: string;
  readonly response?: AiChatResponse;
}

export class AssistantFailure extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    readonly status = 0,
    readonly body: unknown = null,
  ) {
    super('No fue posible completar la consulta.');
  }
}

export interface AttemptRecord {
  readonly attemptGen: number;
  readonly requestId: string;
  readonly contextEpoch: number;
  readonly text: string;
  readonly controller: AbortController;
  readonly timer: ReturnType<typeof setTimeout>;
  terminated: boolean;
  terminationReason?: 'completed' | 'timeout' | 'cancelled' | 'superseded' | 'epoch_mismatch';
}
