export interface SessionConfig {
  mode: 'demo' | 'production';
  clinicalUrl: string;
  gatewayUrl: string;
  authUrl: string;
  issuer: string;
  audience: string;
  scope: string;
  publicKey?: string;
  redirectUri?: string;
}
export function sessionConfig(env: Record<string, string | undefined>): SessionConfig | null {
  const mode = env.APP_ENV;
  if (mode !== 'demo' && mode !== 'production') return null;
  try {
    function endpoint(key: string) {
      const u = new URL(env[key] ?? '');
      if (
        !['http:', 'https:'].includes(u.protocol) ||
        (mode === 'production' && u.protocol !== 'https:') ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw new Error();
      return u.href.replace(/\/$/, '');
    }
    const clinicalUrl = endpoint('CLINICAL_URL'),
      gatewayUrl = endpoint('GATEWAY_URL');
    const authUrl = mode === 'demo' ? clinicalUrl : endpoint('AUTH_URL');
    const issuer = env.AUTH_ISSUER,
      audience = env.AUTH_AUDIENCE;
    if (!issuer || !audience || (mode === 'production' && issuer.toLowerCase().includes('demo')))
      return null;
    if (
      mode === 'production' &&
      (!env.AUTH_PUBLIC_KEY ||
        !env.AUTH_REDIRECT_URI ||
        !/^quimiocare:\/\/acceso\/oauth$/.test(env.AUTH_REDIRECT_URI))
    )
      return null;
    const scope = JSON.stringify([mode, clinicalUrl, gatewayUrl, authUrl, issuer, audience]);
    return {
      mode,
      clinicalUrl,
      gatewayUrl,
      authUrl,
      issuer,
      audience,
      scope,
      ...(mode === 'production'
        ? { publicKey: env.AUTH_PUBLIC_KEY!, redirectUri: env.AUTH_REDIRECT_URI! }
        : {}),
    };
  } catch {
    return null;
  }
}
