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
