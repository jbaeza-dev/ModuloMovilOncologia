export type ProbeOptions = {
  clinicalUrl: string;
  syncUrl: string;
  patient: 'A' | 'B';
};

export function parseProbeUrl(value: string | undefined): string {
  if (!value) throw new Error('Falta configurar la URL del servicio de prueba.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('La URL debe ser HTTP/HTTPS y no contener credenciales.');
  }
  if (url.search || url.hash) throw new Error('La URL base no admite query ni fragmentos.');
  return url.toString().replace(/\/$/, '');
}

export type ProbeSession = { token: string; owner: string; expiresAt: Date };

export function parseProbeSession(body: unknown, expectedOwner?: string): ProbeSession {
  if (!body || typeof body !== 'object') throw new Error('Sesión demo inválida.');
  const row = body as Record<string, unknown>;
  const user = row.user as Record<string, unknown> | undefined;
  const owner = user?.id;
  if (
    typeof row.access_token !== 'string' ||
    !row.access_token ||
    row.token_type !== 'bearer' ||
    typeof owner !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner) ||
    typeof row.expires_in !== 'number' ||
    !Number.isFinite(row.expires_in) ||
    row.expires_in <= 0
  ) {
    throw new Error('La respuesta demo no contiene una identidad válida.');
  }
  if (expectedOwner && owner !== expectedOwner) {
    throw new Error('La sesión cambió de propietario; prueba detenida.');
  }
  return {
    token: row.access_token,
    owner,
    expiresAt: new Date(Date.now() + row.expires_in * 1000),
  };
}
