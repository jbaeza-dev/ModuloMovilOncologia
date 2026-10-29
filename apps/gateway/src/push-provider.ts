import type { GatewayPayloadNotificacion } from '@quimiocare/contracts';

export type PushResult =
  | { state: 'accepted'; ticket: string }
  | { state: 'temporary' | 'permanent' | 'uncertain'; code: string };
export type PushReceipt = { state: 'ok' | 'error' | 'unknown'; code?: string };
export interface PushProvider {
  send(token: string, data: GatewayPayloadNotificacion, signal?: AbortSignal): Promise<PushResult>;
  receipt(ticket: string, signal?: AbortSignal): Promise<PushReceipt>;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const temporary = new Set(['MessageRateExceeded', 'ExpoServerError', 'ProviderTimeout']);
// Keep only known error codes. Provider messages may contain the destination token.
const known = new Set([
  ...temporary,
  'DeviceNotRegistered',
  'MessageTooBig',
  'MismatchSenderId',
  'InvalidCredentials',
]);
function code(v: Record<string, unknown>): string {
  const value = object(v.details) ? v.details.error : undefined;
  return typeof value === 'string' && known.has(value) ? value : 'ProviderRejected';
}
export class ExpoPushProvider implements PushProvider {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 10000,
    private readonly accessToken?: string,
  ) {}
  private async request(path: 'send' | 'getReceipts', body: unknown, signal?: AbortSignal) {
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);
    const response = await this.fetcher('https://exp.host/--/api/v2/push/' + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.accessToken ? { authorization: 'Bearer ' + this.accessToken } : {}),
      },
      body: JSON.stringify(body),
      signal: combined,
      redirect: 'error',
    });
    const reader = response.body?.getReader();
    let text = '',
      bytes = 0;
    try {
      if (reader) {
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 65536) throw new Error('ProviderResponseTooLarge');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      }
    } finally {
      await reader?.cancel().catch(() => undefined);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }
  async send(
    token: string,
    data: GatewayPayloadNotificacion,
    signal?: AbortSignal,
  ): Promise<PushResult> {
    if (!/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(token))
      return { state: 'permanent', code: 'InvalidExpoToken' };
    try {
      const ttl = Math.max(
        0,
        Math.min(600, Math.floor((Date.parse(data.vence_en) - Date.now()) / 1000)),
      );
      // Data only: no title/body/sound, so client validation precedes presentation.
      const { status, json } = await this.request(
        'send',
        { to: token, data, priority: 'high', ttl },
        signal,
      );
      if (status === 429 || status >= 500)
        return { state: 'temporary', code: 'ProviderHttpTemporary' };
      if (status !== 200) return { state: 'permanent', code: 'ProviderHttpRejected' };
      const result = object(json) ? json.data : null;
      if (
        object(result) &&
        result.status === 'ok' &&
        typeof result.id === 'string' &&
        result.id.length > 0 &&
        result.id.length <= 256
      )
        return { state: 'accepted', ticket: result.id };
      if (object(result) && result.status === 'error') {
        const error = code(result);
        return { state: temporary.has(error) ? 'temporary' : 'permanent', code: error };
      }
      return { state: 'uncertain', code: 'ProviderResponseInvalid' };
    } catch {
      return { state: 'uncertain', code: 'ProviderTransportUncertain' };
    }
  }
  async receipt(ticket: string, signal?: AbortSignal): Promise<PushReceipt> {
    try {
      const { status, json } = await this.request('getReceipts', { ids: [ticket] }, signal);
      const receipt =
        status === 200 && object(json) && object(json.data) ? json.data[ticket] : null;
      if (object(receipt) && receipt.status === 'ok') return { state: 'ok' };
      if (object(receipt) && receipt.status === 'error')
        return { state: 'error', code: code(receipt) };
    } catch {
      /* A missing/failed provider receipt is not evidence of delivery. */
    }
    return { state: 'unknown' };
  }
}
