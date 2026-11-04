import { isDemoMode } from '../../utils/environment';

/* Los APK académicos solo pueden exponer reglas en borrador si se presentan explícitamente como una simulación.
 * La puesta en producción permanece bloqueada, incluso si la marca de revisión se proporciona por error. */
export function syntheticReviewEnabled(): boolean {
  return (
    (isDemoMode() || process.env.EXPO_PUBLIC_APP_ENV === 'universidad-demo') &&
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW === 'true'
  );
}
