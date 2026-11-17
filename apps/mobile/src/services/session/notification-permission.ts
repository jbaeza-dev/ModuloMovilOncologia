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
 * siempre generaba un bucle (Redmi 13C, Android 14). Por eso:
 * - con el permiso concedido, o si Android ya no permite pedirlo, nunca se muestra;
 * - un botón de la persona puede pedirlo siempre que Android lo permita;
 * - el registro automático lo pide como máximo una vez por apertura de la app. No basta con
 *   pedirlo solo cuando el estado es «sin respuesta»: tras reinstalar, Android lo informó como
 *   «denegado» (aunque se podía volver a pedir) y el diálogo dejó de aparecer al iniciar sesión.
 */
export function shouldRequestNotificationPermission(
  current: NotificationPermissionSnapshot,
  userInitiated: boolean,
  autoRequestedThisLaunch = false,
): boolean {
  if (current.granted || !current.canAskAgain) return false;
  return userInitiated || !autoRequestedThisLaunch;
}
