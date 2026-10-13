/**
 * Utilidad de entorno para determinar si la aplicación opera en modo demostración.
 * En desarrollo cotidiano (__DEV__ === true) está activo automáticamente.
 * En builds Release con bundle embebido (offline standalone), opera en modo demo
 * por defecto para Sprint 1 salvo que se desactive explícitamente con EXPO_PUBLIC_DEMO_MODE=false.
 */
export function isDemoMode(): boolean {
  return __DEV__ || process.env.EXPO_PUBLIC_DEMO_MODE !== 'false';
}
