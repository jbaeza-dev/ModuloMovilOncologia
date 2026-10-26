import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { operations } from '@quimiocare/contracts';
import type { GatewayConfig } from '../config/index.js';
import { GatewayError } from './errors.js';
export function securityHeaders(config: GatewayConfig): RequestHandler {
  return helmet({
    strictTransportSecurity:
      config.appEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: config.appEnv === 'production' ? [] : null },
    },
  });
}
export function corsPolicy(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  const headers = ['authorization', 'content-type', 'x-request-id'];
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.get('origin');
    if (!origin) {
      next();
      return;
    } // Native Android calls do not need browser CORS.
    if (!allowed.has(origin)) throw new GatewayError(403, 'ORIGEN_NO_PERMITIDO');
    res.setHeader('access-control-allow-origin', origin);
    if (req.method !== 'OPTIONS') {
      next();
      return;
    }
    const method = req.get('access-control-request-method');
    const known = operations.some(
      (op) =>
        op.service === 'gateway' &&
        op.method === method &&
        new RegExp('^' + op.path.replaceAll(/\{\w+\}/g, '[^/]+') + '$').test(req.path),
    );
    if (!known) throw new GatewayError(404, 'RUTA_NO_ENCONTRADA');
    const requested = (req.get('access-control-request-headers') ?? '')
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    if (requested.some((header) => !headers.includes(header)))
      throw new GatewayError(403, 'ORIGEN_NO_PERMITIDO');
    res.vary('Access-Control-Request-Headers');
    res.set({
      'access-control-allow-methods': method!,
      'access-control-allow-headers': 'Authorization, Content-Type, X-Request-ID',
      'access-control-max-age': '600',
    });
    res.status(204).end();
  };
}
