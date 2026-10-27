import { createRemoteJWKSet, jwtVerify, errors } from 'jose';
import type { GatewayConfig } from './config/index.js';
import { GatewayError } from './http/errors.js';
import { dependencyClients } from './dependencies.js';
import type { Logger } from './http/logging.js';
import type { ClinicalUsuarioPerfilResponse } from '@quimiocare/contracts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface Principal {
  readonly id: string;
  readonly token: string;
}

export function authenticator(config: GatewayConfig, log: Logger) {
  const key = config.authJwksUrl
    ? createRemoteJWKSet(new URL(config.authJwksUrl), {
        timeoutDuration: config.dependencyTimeoutMs,
        cooldownDuration: 5000,
        cacheMaxAge: 300000,
      })
    : new TextEncoder().encode(config.authVerifyKey);
  const clients = dependencyClients(config, log);
  async function verify(authorization: string | undefined): Promise<Principal> {
    if (
      !authorization ||
      !/^Bearer [A-Za-z0-9_.-]+$/i.test(authorization) ||
      authorization.length > 8200
    )
      throw new GatewayError(401, 'NO_AUTORIZADO');
    const token = authorization.slice(7);
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: [config.authAlgorithm],
        issuer: config.authIssuer,
        audience: config.authAudience,
        requiredClaims: ['sub', 'iss', 'aud', 'exp', 'iat'],
      });
      if (
        !payload.sub ||
        !UUID.test(payload.sub) ||
        !Number.isInteger(payload.iat) ||
        !Number.isInteger(payload.exp) ||
        payload.iat! > Date.now() / 1000 + 30 ||
        payload.exp! <= payload.iat! ||
        (config.appEnv === 'demo' && payload.cohort !== 'quimiocare-demo') ||
        (config.appEnv === 'production' &&
          (payload.cohort === 'quimiocare-demo' || payload.demo_patient !== undefined))
      )
        throw new GatewayError(401, 'NO_AUTORIZADO');
      return { id: payload.sub.toLowerCase(), token };
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout))
        throw new GatewayError(401, 'NO_AUTORIZADO');
      // An unavailable key authority is not proof of an invalid identity.
      throw new GatewayError(503, 'SERVICIO_NO_DISPONIBLE');
    }
  }
  return {
    verify,
    async authorize(authorization: string | undefined): Promise<Principal> {
      const principal = await verify(authorization);
      const response = await clients.getProfile(principal.token);
      if (response.status === 401) throw new GatewayError(401, 'NO_AUTORIZADO');
      if (response.status === 403) throw new GatewayError(403, 'ACCESO_DENEGADO');
      if (response.status !== 200) throw new GatewayError(503, 'SERVICIO_NO_DISPONIBLE');
      const profile = response.body as ClinicalUsuarioPerfilResponse;
      if (
        profile.id.toLowerCase() !== principal.id ||
        !profile.activo ||
        profile.rol !== 'paciente' ||
        profile.estado_incorporacion !== 'COMPLETO'
      )
        throw new GatewayError(403, 'ACCESO_DENEGADO');
      return principal;
    },
  };
}
