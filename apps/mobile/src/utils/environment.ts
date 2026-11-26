/**
 * El modo de demostración se retiró de la sesión el 26-11-2026: `demo` ya no es un APP_ENV válido
 * y la app solo entra con Google. Se conserva porque el triage y el asistente, en revisión médica,
 * aún lo importan; en cualquier compilación de la app devuelve `false`.
 */
export function isDemoMode(): boolean {
  return process.env.EXPO_PUBLIC_APP_ENV === 'demo';
}

export function isUniversityDemo(): boolean {
  return process.env.EXPO_PUBLIC_APP_ENV === 'universidad-demo';
}

/**
 * Origen web universitario confirmado e institucional (Universidad del Bío-Bío).
 * Utilizado por defecto para la API IFrame de YouTube y cabeceras Referer/Origin
 * en reproductores de contenido educativo cuando no se suministra un origen explícito.
 */
export const UNIVERSITY_VERIFIED_ORIGIN = 'https://parra.chillan.ubiobio.cl';

/**
 * Retorna el origen público verificado para la aplicación móvil, configurable mediante
 * la variable EXPO_PUBLIC_WEB_ORIGIN o recurriendo al origen institucional confirmado.
 */
export function getPublicVerifiedOrigin(): string {
  const envOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim();
  if (envOrigin && (envOrigin.startsWith('https://') || envOrigin.startsWith('http://'))) {
    return envOrigin;
  }
  return UNIVERSITY_VERIFIED_ORIGIN;
}
