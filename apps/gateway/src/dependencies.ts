import { validateRequest, validateResponse } from '@quimiocare/contracts';
import type { OperationId } from '@quimiocare/contracts';
import type { GatewayConfig } from './config/index.js';
import { GatewayError } from './http/errors.js';
import type { Logger } from './http/logging.js';
export function dependencyClients(config: GatewayConfig, log: Logger) {
  async function request(
    dependency: 'clinical' | 'ai',
    path: string,
    method: 'GET' | 'POST',
    token: string,
    operation: OperationId,
    body?: unknown,
  ) {
    if (
      !validateRequest(operation, {
        ...(body === undefined ? {} : { body }),
        ...(operation === 'IA-01' ? { query: { debug: false } } : {}),
      }).valid
    )
      throw new GatewayError(422, 'DATOS_INVALIDOS');
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      dependency === 'ai' ? config.aiTimeoutMs : config.dependencyTimeoutMs,
    );
    let responded = false;
    try {
      const base = dependency === 'ai' ? config.aiUrl : config.clinicalUrl;
      const response = await fetch(base + path, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      responded = true;
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''))
        throw new Error('Invalid dependency media type');
      if (!response.body) throw new Error('Missing dependency body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) throw new Error('Dependency body limit');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!validateResponse(operation, response.status, value).valid)
        throw new Error('Invalid dependency contract');
      log({
        event: 'dependency',
        dependency,
        state: response.status >= 500 ? 'unavailable' : 'ready',
        status: response.status,
        durationMs: Math.round(performance.now() - started),
      });
      return { status: response.status, body: value };
    } catch {
      const failure =
        dependency === 'ai' && controller.signal.aborted
          ? new GatewayError(504, 'IA_TIEMPO_AGOTADO')
          : dependency === 'ai' && responded
            ? new GatewayError(502, 'IA_RESPUESTA_INVALIDA')
            : new GatewayError(503, 'SERVICIO_NO_DISPONIBLE');
      log({
        event: 'dependency',
        dependency,
        state: 'unavailable',
        errorCode: failure.code,
        durationMs: Math.round(performance.now() - started),
      });
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    getProfile: (token: string) => request('clinical', '/api/v1/auth/me', 'GET', token, 'C-01'),
    getClinicalProfile: (token: string) =>
      request('clinical', '/api/v1/pacientes/me/perfil-clinico', 'GET', token, 'C-03'),
    queryAi: (token: string, body: unknown) => {
      if (!validateRequest('G-06', { body }).valid)
        return Promise.reject(new GatewayError(422, 'DATOS_INVALIDOS'));
      return request('ai', '/api/v1/chat?debug=false', 'POST', token, 'IA-01', body);
    },
  };
}
