export interface GatewayConfig {
  appEnv: 'demo' | 'production' | 'universidad-demo';
  port: number;
  corsOrigins: readonly string[];
  databaseUrl: string;
  clinicalUrl: string;
  aiUrl: string;
  authIssuer: string;
  authAudience: string;
  authAlgorithm: 'HS256' | 'RS256' | 'ES256';
  authJwksUrl?: string;
  cursorKey: string;
  authVerifyKey: string;
  dependencyTimeoutMs: number;
  aiTimeoutMs: number;
  requestTimeoutMs: number;
  shutdownTimeoutMs: number;
  pushProvider: 'expo';
  agendaTimezone: 'America/Santiago';
  agendaMaxReminders: number;
}
export class ConfigurationError extends Error {
  constructor(readonly field: string) {
    super(`Configuración inválida: ${field}.`);
  }
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const required = (key: string): string => {
    const value = env[key];
    if (!value || value !== value.trim() || /[\r\n]/.test(value)) throw new ConfigurationError(key);
    return value;
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key] ?? String(fallback);
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max)
      throw new ConfigurationError(key);
    return parsed;
  };
  const appEnv = required('APP_ENV');
  if (appEnv !== 'demo' && appEnv !== 'production' && appEnv !== 'universidad-demo')
    throw new ConfigurationError('APP_ENV');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw new ConfigurationError('NODE_TLS_REJECT_UNAUTHORIZED');
  const url = (key: string, protocols: string[]) => {
    let parsed: URL;
    try {
      parsed = new URL(required(key));
    } catch {
      throw new ConfigurationError(key);
    }
    if (!protocols.includes(parsed.protocol) || parsed.hash) throw new ConfigurationError(key);
    return parsed;
  };
  const dependencyUrl = (key: string) => {
    const value = url(key, appEnv === 'production' ? ['https:'] : ['http:', 'https:']);
    if (value.username || value.password || value.search) throw new ConfigurationError(key);
    return value.href.replace(/\/$/, '');
  };
  const database = url('GATEWAY_DATABASE_URL', ['postgres:', 'postgresql:']);
  if (
    !database.username ||
    !database.password ||
    !/^\/qc_gateway_[a-z0-9_]+$/.test(database.pathname)
  )
    throw new ConfigurationError('GATEWAY_DATABASE_URL');
  if (
    (appEnv === 'demo' || appEnv === 'universidad-demo') &&
    !database.pathname.startsWith('/qc_gateway_demo')
  )
    throw new ConfigurationError('GATEWAY_DATABASE_URL');
  if (
    appEnv === 'production' &&
    (database.pathname.includes('demo') || database.searchParams.get('sslmode') !== 'verify-full')
  )
    throw new ConfigurationError('GATEWAY_DATABASE_URL');
  const corsOrigins = [
    ...new Set(
      (env.CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  for (const origin of corsOrigins) {
    try {
      const parsed = new URL(origin);
      if (
        parsed.origin !== origin ||
        !['http:', 'https:'].includes(parsed.protocol) ||
        (appEnv === 'production' && parsed.protocol !== 'https:')
      )
        throw new Error('Invalid origin');
    } catch {
      throw new ConfigurationError('CORS_ALLOWED_ORIGINS');
    }
  }
  const authIssuer = required('AUTH_EXPECTED_ISSUER');
  if (appEnv === 'production' && authIssuer.toLowerCase().includes('demo'))
    throw new ConfigurationError('AUTH_EXPECTED_ISSUER');
  const authAlgorithm = required('AUTH_ALLOWED_ALGORITHM');
  if (!['HS256', 'RS256', 'ES256'].includes(authAlgorithm))
    throw new ConfigurationError('AUTH_ALLOWED_ALGORITHM');
  const authVerifyKey = authAlgorithm === 'HS256' ? required('AUTH_VERIFY_KEY') : '';
  if (authAlgorithm === 'HS256' && (Buffer.byteLength(authVerifyKey) < 32 || env.AUTH_JWKS_URL))
    throw new ConfigurationError('AUTH_VERIFY_KEY');
  const authJwksUrl = authAlgorithm === 'HS256' ? undefined : dependencyUrl('AUTH_JWKS_URL');
  if (authJwksUrl && env.AUTH_VERIFY_KEY) throw new ConfigurationError('AUTH_VERIFY_KEY');
  const cursorKey = env.GATEWAY_CURSOR_KEY ?? (authAlgorithm === 'HS256' ? authVerifyKey : '');
  if (Buffer.byteLength(cursorKey) < 32) throw new ConfigurationError('GATEWAY_CURSOR_KEY');
  if (required('PUSH_PROVIDER') !== 'expo') throw new ConfigurationError('PUSH_PROVIDER');
  if ((env.AGENDA_TIMEZONE ?? 'America/Santiago') !== 'America/Santiago')
    throw new ConfigurationError('AGENDA_TIMEZONE');
  const aiTimeoutMs = integer('AI_TIMEOUT_MS', 60000, 100, 120000);
  const requestTimeoutMs = integer('HTTP_REQUEST_TIMEOUT_MS', 65000, 200, 130000);
  const dependencyTimeoutMs = integer('DEPENDENCY_TIMEOUT_MS', 5000, 100, 30000);
  if (requestTimeoutMs <= Math.max(aiTimeoutMs, dependencyTimeoutMs))
    throw new ConfigurationError('HTTP_REQUEST_TIMEOUT_MS');
  return {
    appEnv,
    corsOrigins,
    port: integer('GATEWAY_PORT', 3001, 1, 65535),
    databaseUrl: database.href,
    clinicalUrl: dependencyUrl('CLINICAL_API_URL'),
    aiUrl: dependencyUrl('AI_API_URL'),
    authIssuer,
    authAudience: required('AUTH_EXPECTED_AUDIENCE'),
    authAlgorithm: authAlgorithm as GatewayConfig['authAlgorithm'],
    ...(authJwksUrl ? { authJwksUrl } : {}),
    cursorKey,
    authVerifyKey,
    dependencyTimeoutMs,
    aiTimeoutMs,
    requestTimeoutMs,
    shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 10000, 100, 30000),
    pushProvider: 'expo',
    agendaTimezone: 'America/Santiago',
    agendaMaxReminders: integer('AGENDA_MAX_REMINDERS', 100, 1, 100),
  };
}
