export interface NotificationPermissionSnapshot {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

/**
 * Decide si corresponde mostrar el diálogo de permiso de notificaciones de Android.
 *
 * Pedir el permiso abre la pantalla del sistema aunque ya esté concedido; la app se pausa y
 * vuelve a primer plano. Como al volver a primer plano se registra otra vez el teléfono, pedirlo
 * siempre generaba un bucle (Redmi 13C, Android 14). Por eso solo se pide la primera vez o cuando
 * la persona lo solicita con un botón.
 */
export function shouldRequestNotificationPermission(
  current: NotificationPermissionSnapshot,
  userInitiated: boolean,
): boolean {
  if (current.granted) return false;
  if (current.status === 'undetermined') return true;
  return userInitiated && current.canAskAgain;
}
