import express from 'express';
import { securityHeaders, corsPolicy } from './security.js';
import type { Express, ErrorRequestHandler, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  operations,
  parametersFor,
  parseQuery,
  validateRequest,
  validateResponse,
} from '@quimiocare/contracts';
import type { OperationId } from '@quimiocare/contracts';
import type { GatewayConfig } from '../config/index.js';
import type { Database } from '../persistence/database.js';
import { databaseReady } from '../persistence/migrations.js';
import { errorEnvelope, GatewayError } from './errors.js';
import { createLogger, VERSION } from './logging.js';
import type { Logger } from './logging.js';
interface RequestState {
  requestId: string;
  operation: OperationId | 'readiness' | 'unmatched';
  error?: GatewayError;
}
export function createApp(
  config: GatewayConfig,
  db: Database,
  log: Logger = createLogger(),
): Express {
  const app = express();
  const states = new WeakMap<Request, RequestState>();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('strict routing', true);
  app.set('case sensitive routing', true);
  app.set('query parser', 'simple');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    const state: RequestState = { requestId: randomUUID(), operation: 'unmatched' };
    states.set(req, state);
    res.set({
      'x-request-id': state.requestId,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    const started = performance.now();
    const timer = setTimeout(() => {
      if (res.writableEnded) return;
      state.error = new GatewayError(503, 'SERVICIO_NO_DISPONIBLE');
      res.status(503).json(errorEnvelope(state.error, state.requestId));
    }, config.requestTimeoutMs);
    timer.unref();
    res.once('close', () => clearTimeout(timer));
    res.once('finish', () => {
      clearTimeout(timer);
      log({
        event: 'request',
        requestId: state.requestId,
        operation: state.operation,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
        ...(state.error ? { errorCode: state.error.code } : {}),
      });
    });
    next();
  });
  app.use(securityHeaders(config));
  app.use(corsPolicy(config.corsOrigins));
  app.get('/health', (_req, res) => {
    states.get(_req)!.operation = 'G-01';
    const body = { estado: 'ok', servicio: 'quimiocare-gateway', version: VERSION };
    if (!validateResponse('G-01', 200, body).valid) throw new GatewayError(500, 'ERROR_SERVIDOR');
    res.json(body);
  });
  // Private operational probe; publish /health, never forward /internal through the public proxy.
  app.get('/internal/ready', async (req, res) => {
    states.get(req)!.operation = 'readiness';
    await databaseReady(db);
    log({ event: 'dependency', dependency: 'database', state: 'ready' });
    if (!res.writableEnded) res.json({ estado: 'listo' });
  });
  for (const operation of operations.filter((op) => op.service === 'gateway' && op.id !== 'G-01')) {
    const path = operation.path.replaceAll(/\{(\w+)\}/g, ':$1');
    const route = app.route(path);
    const handler = [
      (req: Request, _res: Response, next: () => void) => {
        states.get(req)!.operation = operation.id;
        next();
      },
      express.json({
        strict: true,
        inflate: false,
        limit: ['G-12', 'G-13'].includes(operation.id) ? 65536 : 16384,
        type: 'application/json',
      }),
      (req: Request) => {
        if (req.res?.writableEnded) return;
        const url = new URL(req.originalUrl, 'http://gateway.invalid');
        const allowedQuery = parametersFor(operation)
          .filter((p) => p.in === 'query')
          .map((p) => p.name);
        if ([...url.searchParams.keys()].some((key) => !allowedQuery.includes(key)))
          throw new GatewayError(422, 'DATOS_INVALIDOS');
        if (
          (req.headers['content-length'] !== undefined ||
            req.headers['transfer-encoding'] !== undefined) &&
          !req.is('application/json')
        )
          throw new GatewayError(422, 'DATOS_INVALIDOS');
        const body: unknown = req.body;
        if (
          !validateRequest(operation.id, {
            body,
            query: parseQuery(operation.id, url.searchParams),
            path: req.params,
          }).valid
        )
          throw new GatewayError(422, 'DATOS_INVALIDOS');
        // P02 is deliberately closed. No decoded bearer or test-only principal can enable protected routes.
        throw new GatewayError(503, 'AUTENTICACION_NO_CONFIGURADA');
      },
    ];
    switch (operation.method) {
      case 'GET':
        route.get(...handler);
        break;
      case 'POST':
        route.post(...handler);
        break;
      case 'PUT':
        route.put(...handler);
        break;
      case 'DELETE':
        route.delete(...handler);
        break;
      default:
        throw new Error('Método contractual no soportado.');
    }
  }
  app.use(() => {
    throw new GatewayError(404, 'RUTA_NO_ENCONTRADA');
  });
  const errors: ErrorRequestHandler = (error: unknown, req, res, next) => {
    void next; // Express recognizes error middleware by its four arguments.
    if (res.writableEnded || res.destroyed) return;
    const state = states.get(req)!;
    const type = error && typeof error === 'object' && 'type' in error ? error.type : undefined;
    const failure =
      error instanceof GatewayError
        ? error
        : type === 'entity.too.large'
          ? new GatewayError(413, 'SOLICITUD_DEMASIADO_GRANDE')
          : type === 'entity.parse.failed'
            ? new GatewayError(400, 'DATOS_INVALIDOS')
            : [
                  'encoding.unsupported',
                  'charset.unsupported',
                  'request.size.invalid',
                  'request.aborted',
                ].includes(String(type))
              ? new GatewayError(400, 'DATOS_INVALIDOS')
              : state.operation === 'readiness'
                ? new GatewayError(503, 'SERVICIO_NO_DISPONIBLE')
                : new GatewayError(500, 'ERROR_SERVIDOR');
    state.error = failure;
    if (state.operation === 'readiness')
      log({ event: 'dependency', dependency: 'database', state: 'unavailable' });
    res.status(failure.status).json(errorEnvelope(failure, state.requestId));
  };
  app.use(errors);
  return app;
}
