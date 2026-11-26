export interface SessionConfig {
  mode: 'production' | 'universidad-demo';
  clinicalUrl: string;
  gatewayUrl: string;
  authUrl: string;
  issuer: string;
  audience: string;
  scope: string;
  publicKey: string;
  redirectUri: string;
}

/** Ambos modos usan Google con OAuth 2.0 + PKCE; el modo de demostración se retiró el 26-11-2026. */
export function sessionConfig(env: Record<string, string | undefined>): SessionConfig | null {
  const mode = env.APP_ENV;
  if (mode !== 'production' && mode !== 'universidad-demo') return null;
  try {
    function endpoint(key: string) {
      const u = new URL(env[key] ?? '');
      const isLoopback = ['127.0.0.1', 'localhost'].includes(u.hostname);
      if (
        !['http:', 'https:'].includes(u.protocol) ||
        (u.protocol !== 'https:' && !(mode === 'universidad-demo' && isLoopback)) ||
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
    const authUrl = endpoint('AUTH_URL');
    if (new URL(authUrl).protocol !== 'https:' || authUrl !== env.AUTH_ISSUER) return null;
    const issuer = env.AUTH_ISSUER,
      audience = env.AUTH_AUDIENCE;
    if (!issuer || !audience || (mode === 'production' && issuer.toLowerCase().includes('demo')))
      return null;
    const publicKey = env.AUTH_PUBLIC_KEY,
      redirectUri = env.AUTH_REDIRECT_URI;
    if (!publicKey || !redirectUri || !/^quimiocare:\/\/acceso\/oauth$/.test(redirectUri))
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
      publicKey,
      redirectUri,
    };
  } catch {
    return null;
  }
}
