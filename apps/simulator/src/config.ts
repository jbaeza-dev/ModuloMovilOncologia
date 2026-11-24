import { resolve } from 'node:path';

export interface SimulatorConfig {
  appEnv: 'demo' | 'universidad-demo';
  databaseUrl: string;
  signingKey: string;
  controlKey: string;
  issuer: string;
  audience: string;
  publicBaseUrl: string;
  port: number;
  host: string;
  service: 'clinical' | 'ai';
  authProvider: 'synthetic' | 'supabase';
  authAlgorithm?: 'ES256' | 'RS256';
  authJwksUrl?: string | undefined;
  authPublicKey?: string | undefined;
  apiDocsEnabled: boolean;
  preparationEnabled?: boolean;
  operatorAllowedEmails?: string[];
  educationMediaRoot: string;
  educationTempDir: string;
  aiServiceUrl: string;
  geminiApiKey?: string | undefined;
}

/**
 * La configuración sale solo de las variables de entorno, como en el gateway; no se leen archivos
 * `.env`. Para probar en local con una clave propia:
 * `node --env-file=apps/simulator/.env.local apps/simulator/dist/server.js`.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): SimulatorConfig {
  const appEnv = (env.APP_ENV ?? 'demo') as 'demo' | 'universidad-demo';
  if (appEnv !== 'demo' && appEnv !== 'universidad-demo') {
    throw new Error('El simulador exige APP_ENV=demo o APP_ENV=universidad-demo.');
  }

  const required = (name: string, minimum = 1): string => {
    const value = env[name];
    if (!value || value.length < minimum)
      throw new Error(`Configuración ausente o inválida: ${name}`);
    return value;
  };

  const service = env.SIMULATOR_SERVICE ?? 'clinical';
  if (service !== 'clinical' && service !== 'ai') throw new Error('SIMULATOR_SERVICE inválido.');

  const port = Number(env.SIMULATOR_PORT ?? (service === 'ai' ? '3003' : '3002'));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('SIMULATOR_PORT inválido.');

  const publicBaseUrl = required('SIMULATOR_PUBLIC_BASE_URL');
  const url = new URL(publicBaseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Base pública inválida.');

  const authProvider = (env.AUTH_PROVIDER ??
    (appEnv === 'universidad-demo' ? 'supabase' : 'synthetic')) as 'synthetic' | 'supabase';

  if (
    !['synthetic', 'supabase'].includes(authProvider) ||
    (appEnv === 'universidad-demo' && authProvider !== 'supabase')
  )
    throw new Error('AUTH_PROVIDER inválido.');
  const authAlgorithm = env.AUTH_ALLOWED_ALGORITHM ?? 'ES256';
  if (authProvider === 'supabase') {
    if (!['ES256', 'RS256'].includes(authAlgorithm))
      throw new Error('AUTH_ALLOWED_ALGORITHM inválido.');
    const issuer = new URL(required('AUTH_EXPECTED_ISSUER'));
    const jwks = new URL(required('AUTH_JWKS_URL'));
    if (
      [
        issuer,
        ...(env.AUTH_JWKS_MODE === 'distributed' &&
        appEnv === 'universidad-demo' &&
        jwks.href === 'http://qc-jwks:3004/jwks.json'
          ? []
          : [jwks]),
      ].some((u) => u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
    )
      throw new Error('Supabase exige issuer y JWKS HTTPS.');
    if (
      jwks.href !== issuer.href.replace(/\/$/, '') + '/.well-known/jwks.json' &&
      !(
        env.AUTH_JWKS_MODE === 'distributed' &&
        appEnv === 'universidad-demo' &&
        jwks.href === 'http://qc-jwks:3004/jwks.json'
      )
    )
      throw new Error('AUTH_JWKS_URL no corresponde al issuer.');
  }

  const signingKey =
    authProvider === 'synthetic'
      ? required('DEMO_SIGNING_KEY', 32)
      : env.DEMO_SIGNING_KEY || 'universidad-demo-fallback-signing-key-minimum-32-chars';

  const authJwksUrl = env.AUTH_JWKS_URL;
  const authPublicKey = env.AUTH_PUBLIC_KEY;
  if (authPublicKey) {
    let publishable = authPublicKey.startsWith('sb_publishable_');
    try {
      publishable ||=
        JSON.parse(Buffer.from(authPublicKey.split('.')[1] ?? '', 'base64url').toString()).role ===
        'anon';
    } catch {
      /* Only a publishable key or legacy anon key may reach the browser. */
    }
    if (!publishable)
      throw new Error('AUTH_PUBLIC_KEY debe ser una clave publicable o anon, nunca un secreto.');
  }
  const apiDocsEnabled = env.API_DOCS_ENABLED === 'true';
  const operatorAllowedEmails =
    env.OPERATOR_ALLOWED_EMAILS === undefined
      ? undefined
      : [
          ...new Set(
            env.OPERATOR_ALLOWED_EMAILS.split(',')
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean),
          ),
        ];
  if (operatorAllowedEmails?.some((email) => !/^\S+@[^\s@]+\.[^\s@]+$/.test(email)))
    throw new Error('OPERATOR_ALLOWED_EMAILS inválido.');
  const educationMediaRoot =
    env.EDUCATION_MEDIA_ROOT || resolve(process.cwd(), '.local_storage/media/educacion');
  const educationTempDir =
    env.EDUCATION_TEMP_DIR || resolve(process.cwd(), '.local_storage/media/temp');
  const aiServiceUrl = env.AI_SERVICE_URL || 'http://127.0.0.1:3003';

  return {
    appEnv,
    databaseUrl: required('DATABASE_URL'),
    signingKey,
    controlKey: required('DEMO_CONTROL_KEY', 32),
    issuer:
      env.AUTH_EXPECTED_ISSUER ??
      (authProvider === 'supabase'
        ? 'https://quimiocare-auth.supabase.co/auth/v1'
        : 'quimiocare-demo'),
    audience: env.AUTH_EXPECTED_AUDIENCE ?? 'authenticated',
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ''),
    host: env.SIMULATOR_HOST ?? '0.0.0.0',
    service,
    port,
    authProvider,
    authJwksUrl,
    authPublicKey,
    apiDocsEnabled,
    ...(operatorAllowedEmails === undefined ? {} : { operatorAllowedEmails }),
    preparationEnabled: env.PREPARATION_ENABLED === 'true',
    educationMediaRoot,
    educationTempDir,
    aiServiceUrl,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    ...(authProvider === 'supabase' ? { authAlgorithm: authAlgorithm as 'ES256' | 'RS256' } : {}),
  };
}
