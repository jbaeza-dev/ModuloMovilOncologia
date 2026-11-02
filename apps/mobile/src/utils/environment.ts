/**
 * Utilidad de entorno para determinar si la aplicación opera en modo demostración.
 * En desarrollo cotidiano (__DEV__ === true) está activo automáticamente.
 * En builds Release con bundle embebido (offline standalone), se activa explícitamente
 * mediante la variable de entorno de compilación EXPO_PUBLIC_DEMO_MODE=true.
 */
export function isDemoMode(): boolean {
  if (process.env.EXPO_PUBLIC_APP_ENV) return process.env.EXPO_PUBLIC_APP_ENV === 'demo';
  return __DEV__ || process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
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
