export interface SimulatorConfig {
  databaseUrl: string;
  signingKey: string;
  controlKey: string;
  issuer: string;
  audience: string;
  publicBaseUrl: string;
  port: number;
  host: string;
  service: 'clinical' | 'ai';
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): SimulatorConfig {
  if (env.APP_ENV !== 'demo') throw new Error('El simulador exige APP_ENV=demo.');
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
  return {
    databaseUrl: required('DATABASE_URL'),
    signingKey: required('DEMO_SIGNING_KEY', 32),
    controlKey: required('DEMO_CONTROL_KEY', 32),
    issuer: env.AUTH_EXPECTED_ISSUER ?? 'quimiocare-demo',
    audience: env.AUTH_EXPECTED_AUDIENCE ?? 'authenticated',
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ''),
    host: env.SIMULATOR_HOST ?? '0.0.0.0',
    service,
    port,
  };
}
