import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, errors, customFetch } from 'jose';
import type { SimulatorConfig } from './config.js';
import type { Database } from './db.js';
import { one, transaction } from './db.js';
import { ApiError } from './errors.js';
import { scenarioFor } from './scenarios.js';
import { PATIENTS } from './types.js';
import type { DemoPatient, Principal } from './types.js';

const unauthorized = (msg = 'Credencial sintética inválida o vencida.') =>
  new ApiError(401, 'HTTP_401', msg);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const remoteJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(url: string) {
  let jwks = remoteJwks.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url), {
      timeoutDuration: 5000,
      cooldownDuration: url === 'http://qc-jwks:3004/jwks.json' ? 0 : 5000,
      cacheMaxAge: url === 'http://qc-jwks:3004/jwks.json' ? 0 : 300000,
      [customFetch]: async (url, options) => {
        const response = await fetch(url, options);
        if (response.status !== 200) throw new Error('Key authority unavailable.');
        return response;
      },
    });
    remoteJwks.set(url, jwks);
  }
  return jwks;
}

export function signAccess(
  config: SimulatorConfig,
  patient: DemoPatient,
  generation: string,
  now = Date.now(),
): string {
  const issued = Math.floor(now / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({
    sub: PATIENTS[patient],
    iss: config.issuer,
    aud: config.audience,
    iat: issued,
    exp: issued + 3600,
    role: 'paciente',
    demo_patient: patient,
    cohort: 'quimiocare-demo',
    demo_generation: generation,
  });
  const signed = `${header}.${claims}`;
  return `${signed}.${createHmac('sha256', config.signingKey).update(signed).digest('base64url')}`;
}

export function verifySyntheticAccess(
  config: SimulatorConfig,
  token: string,
  now = Date.now(),
): Principal {
  try {
    if (token.length > 8192) throw unauthorized();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
      throw unauthorized();
    const [headerPart, claimPart, signaturePart] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const claims = JSON.parse(Buffer.from(claimPart, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw unauthorized();
    const expected = createHmac('sha256', config.signingKey)
      .update(`${headerPart}.${claimPart}`)
      .digest();
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
      throw unauthorized();
    const patient = claims.demo_patient;
    const seconds = Math.floor(now / 1000);
    if (
      (patient !== 'A' && patient !== 'B') ||
      claims.sub !== PATIENTS[patient] ||
      claims.iss !== config.issuer ||
      claims.aud !== config.audience ||
      claims.role !== 'paciente' ||
      claims.cohort !== 'quimiocare-demo' ||
      !Number.isInteger(claims.exp) ||
      !Number.isInteger(claims.iat) ||
      Number(claims.exp) <= seconds ||
      Number(claims.iat) > seconds + 30 ||
      typeof claims.demo_generation !== 'string'
    )
      throw unauthorized();
    return { id: PATIENTS[patient], demo: patient, generation: claims.demo_generation };
  } catch {
    throw unauthorized();
  }
}

export async function verifyExternalAccess(
  config: SimulatorConfig,
  token: string,
  now = Date.now(),
): Promise<Principal> {
  if (token.length > 8192) throw unauthorized();
  try {
    const jwksUrl = config.authJwksUrl || `${config.issuer}/.well-known/jwks.json`;
    const jwks = getJwks(jwksUrl);
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: [config.authAlgorithm ?? 'ES256'],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ['sub', 'iss', 'aud', 'exp', 'iat'],
      currentDate: new Date(now),
    });
    if (
      !payload.sub ||
      !UUID.test(payload.sub) ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.iat! > now / 1000 + 30 ||
      payload.exp! <= payload.iat! ||
      payload.role !== 'authenticated' ||
      payload.is_anonymous === true ||
      typeof payload.app_metadata !== 'object' ||
      !payload.app_metadata ||
      (payload.app_metadata as Record<string, unknown>).provider !== 'google'
    ) {
      throw unauthorized('Subject inválido.');
    }
    return {
      id: payload.sub.toLowerCase(),
      tipo: 'external',
      issuer: config.issuer,
      ...(typeof payload.user_metadata === 'object' && payload.user_metadata
        ? {
            displayName: String(
              (payload.user_metadata as Record<string, unknown>).full_name ??
                (payload.user_metadata as Record<string, unknown>).name ??
                '',
            )
              .split('')
              .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
              .join('')
              .trim()
              .slice(0, 120),
          }
        : {}),
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
      throw unauthorized('Token de Supabase inválido o expirado.');
    }
    throw new ApiError(503, 'HTTP_503', 'Autoridad de claves no disponible.');
  }
}

export function verifyAccess(
  config: SimulatorConfig,
  token: string,
  now = Date.now(),
): Principal | Promise<Principal> {
  if (config.authProvider === 'supabase') {
    return verifyExternalAccess(config, token, now);
  }
  return verifySyntheticAccess(config, token, now);
}

export async function operatorFromHeader(
  config: SimulatorConfig,
  authorization: string | undefined,
): Promise<Principal> {
  return await principalFromHeader(config, authorization);
}

export async function principalFromHeader(
  config: SimulatorConfig,
  authorization: string | undefined,
): Promise<Principal> {
  if (!authorization?.startsWith('Bearer ')) throw unauthorized();
  return await verifyAccess(config, authorization.slice(7));
}

export function verifyControl(config: SimulatorConfig, supplied: string | undefined): void {
  const actual = Buffer.from(supplied ?? '');
  const expected = Buffer.from(config.controlKey);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw unauthorized();
}

export async function issueSession(db: Database, config: SimulatorConfig, patient: DemoPatient) {
  const generation = (await scenarioFor(db, PATIENTS[patient])).session_epoch;
  const refresh = randomBytes(48).toString('base64url');
  await db.query(
    "INSERT INTO qc_demo_refresh(token_hash,paciente_id,vence_en) VALUES($1,$2,now()+interval '24 hours')",
    [hashToken(refresh), PATIENTS[patient]],
  );
  return {
    access_token: signAccess(config, patient, generation),
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: PATIENTS[patient], paciente_demo: patient },
  };
}

export async function refreshSession(db: Database, config: SimulatorConfig, token: string) {
  return transaction(db, async (client) => {
    const stored = await one<{ paciente_id: string; vence_en: Date; consumido: boolean }>(
      client,
      'SELECT paciente_id,vence_en,consumido FROM qc_demo_refresh WHERE token_hash=$1 FOR UPDATE',
      [hashToken(token)],
    );
    if (!stored || stored.consumido || stored.vence_en.getTime() <= Date.now())
      throw unauthorized();
    const patient: DemoPatient = stored.paciente_id === PATIENTS.A ? 'A' : 'B';
    if (stored.paciente_id !== PATIENTS[patient]) throw unauthorized();
    const next = randomBytes(48).toString('base64url');
    await client.query('UPDATE qc_demo_refresh SET consumido=true WHERE token_hash=$1', [
      hashToken(token),
    ]);
    await client.query(
      'INSERT INTO qc_demo_refresh(token_hash,paciente_id,vence_en) VALUES($1,$2,$3)',
      [hashToken(next), stored.paciente_id, stored.vence_en],
    );
    const generation = (await scenarioFor(client, stored.paciente_id)).session_epoch;
    return {
      access_token: signAccess(config, patient, generation),
      refresh_token: next,
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: PATIENTS[patient], paciente_demo: patient },
    };
  });
}
