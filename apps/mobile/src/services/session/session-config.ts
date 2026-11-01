export interface SessionConfig {
  mode: 'demo' | 'production' | 'universidad-demo';
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
  if (mode !== 'demo' && mode !== 'production' && mode !== 'universidad-demo') return null;
  const isSecureMode = mode === 'production' || mode === 'universidad-demo';
  try {
    function endpoint(key: string) {
      const u = new URL(env[key] ?? '');
      const isLoopback = ['127.0.0.1', 'localhost'].includes(u.hostname);
      if (
        !['http:', 'https:'].includes(u.protocol) ||
        (isSecureMode && u.protocol !== 'https:' && !(mode === 'universidad-demo' && isLoopback)) ||
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
    if (isSecureMode && (new URL(authUrl).protocol !== 'https:' || authUrl !== env.AUTH_ISSUER))
      return null;
    const issuer = env.AUTH_ISSUER,
      audience = env.AUTH_AUDIENCE;
    if (!issuer || !audience || (mode === 'production' && issuer.toLowerCase().includes('demo')))
      return null;
    if (
      isSecureMode &&
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
      ...(isSecureMode
        ? { publicKey: env.AUTH_PUBLIC_KEY!, redirectUri: env.AUTH_REDIRECT_URI! }
        : {}),
    };
  } catch {
    return null;
  }
}
