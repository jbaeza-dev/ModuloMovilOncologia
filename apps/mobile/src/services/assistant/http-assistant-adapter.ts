import type { AiChatResponse, AiDebugInfo } from '@quimiocare/contracts';
import type { AssistantAdapter } from './assistant-adapter';
import {
  AssistantFailure,
  type SendMessageOptions,
  type AssistantResponse,
} from './assistant-types';
import type { HttpSessionAdapter } from '../session/http-session-adapter';
import { SessionFailure } from '../session/http-session-types';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');
function debug(value: unknown): value is AiDebugInfo {
  return (
    object(value) &&
    ['origen', 'confianza_razon', 'modelo'].every((k) => typeof value[k] === 'string') &&
    typeof value.confianza_score === 'number' &&
    Number.isFinite(value.confianza_score) &&
    ['tokens_prompt', 'tokens_respuesta', 'ms_busqueda', 'ms_llm'].every(
      (k) => typeof value[k] === 'number' && Number.isInteger(value[k]),
    ) &&
    ['motivos_alarma', 'keywords', 'temas'].every((k) => strings(value[k]))
  );
}
export function parseAssistantResponse(value: unknown): AiChatResponse {
  if (
    !object(value) ||
    typeof value.respuesta !== 'string' ||
    !Array.isArray(value.fuentes) ||
    !value.fuentes.every(
      (source) =>
        object(source) &&
        typeof source.tema_id === 'string' &&
        typeof source.guia === 'number' &&
        Number.isInteger(source.guia) &&
        typeof source.tema === 'string',
    ) ||
    typeof value.requiere_urgencia !== 'boolean' ||
    typeof value.confianza_nivel !== 'string' ||
    !['respuesta', 'sin_informacion', 'cortesia', 'no_disponible'].includes(
      String(value.estado_respuesta),
    ) ||
    (value.debug !== undefined && value.debug !== null && !debug(value.debug))
  )
    throw new AssistantFailure('server_error', 502);
  return value as unknown as AiChatResponse;
}
type Session = Pick<HttpSessionAdapter, 'getCurrentUser' | 'getContextSignal' | 'request'>;
export class HttpAssistantAdapter implements AssistantAdapter {
  readonly isConfigured = true;
  constructor(private readonly session: Session) {}
  async sendMessage(text: string, options: SendMessageOptions): Promise<AssistantResponse> {
    const user = this.session.getCurrentUser(),
      owner = user?.id,
      context = this.session.getContextSignal();
    if (
      !user ||
      !owner ||
      !options.patientId ||
      (options.patientId !== owner && options.patientId !== user.localPatientId)
    )
      throw new AssistantFailure('session_required');
    const assert = () => {
      if (
        context.aborted ||
        this.session.getCurrentUser()?.id !== owner ||
        options.signal?.aborted
      ) {
        const error = new Error('Consulta cancelada.');
        error.name = 'AbortError';
        throw error;
      }
    };
    assert();
    if (!text.trim() || Array.from(text).length > 2000)
      throw new AssistantFailure('validation_error');
    try {
      const response = await this.session.request(
        'gateway',
        '/api/gateway/chatbot/consulta',
        'POST',
        { mensaje: text, activar_alarmas: true },
        {
          signal: options.signal,
          timeoutMs: 75000,
          retryUnauthorized: false,
          preserveServiceErrors: true,
        },
      );
      assert();
      if (response.status !== 200)
        throw new AssistantFailure(
          response.status === 504
            ? 'timeout'
            : response.status === 401 || response.status === 403
              ? 'session_required'
              : 'server_error',
          response.status,
          response.body,
        );
      const result = parseAssistantResponse(response.body);
      return {
        replyText: result.respuesta,
        isDemo: user.isDemo,
        requestId: options.requestId,
        response: result,
      };
    } catch (error) {
      assert();
      if (error instanceof SessionFailure)
        throw new AssistantFailure(
          error.kind === 'expired' || error.kind === 'denied'
            ? 'session_required'
            : error.status === 408
              ? 'timeout'
              : error.kind === 'unavailable'
                ? 'network_offline'
                : 'server_error',
          error.status,
        );
      throw error;
    }
  }
}
