import { describe, expect, it } from 'vitest';
import { shouldRequestNotificationPermission } from './notification-permission';

const granted = { granted: true, status: 'granted', canAskAgain: true };
const undetermined = { granted: false, status: 'undetermined', canAskAgain: true };
const deniedCanAsk = { granted: false, status: 'denied', canAskAgain: true };
const deniedFixed = { granted: false, status: 'denied', canAskAgain: false };

describe('Permiso de notificaciones al registrar el teléfono', () => {
  // Pedirlo con el permiso concedido abría la pantalla del sistema, la app volvía a primer plano y
  // se registraba otra vez: un bucle de ~2 ciclos por segundo en un Redmi 13C con Android 14.
  it('con el permiso concedido no vuelve a pedirlo, aunque lo pida un botón', () => {
    expect(shouldRequestNotificationPermission(granted, false)).toBe(false);
    expect(shouldRequestNotificationPermission(granted, true)).toBe(false);
    expect(shouldRequestNotificationPermission(granted, false, true)).toBe(false);
  });

  it('la primera vez (sin respuesta previa) lo pide de forma automática', () => {
    expect(shouldRequestNotificationPermission(undetermined, false)).toBe(true);
  });

  // Tras reinstalar en el Redmi 13C, Android lo informó como «denegado» aunque se podía volver a
  // pedir, y el diálogo dejó de aparecer al iniciar sesión (prueba 1a).
  it('tras reinstalar, aunque figure «denegado», lo pide al iniciar si Android aún lo permite', () => {
    expect(shouldRequestNotificationPermission(deniedCanAsk, false)).toBe(true);
  });

  it('el registro automático lo pide como máximo una vez por apertura de la app', () => {
    expect(shouldRequestNotificationPermission(undetermined, false, true)).toBe(false);
    expect(shouldRequestNotificationPermission(deniedCanAsk, false, true)).toBe(false);
  });

  it('si Android ya no permite pedirlo, no lo pide ni de forma automática ni con un botón', () => {
    expect(shouldRequestNotificationPermission(deniedFixed, false)).toBe(false);
    expect(shouldRequestNotificationPermission(deniedFixed, true)).toBe(false);
  });

  it('un botón lo vuelve a pedir aunque el registro automático ya lo haya pedido', () => {
    expect(shouldRequestNotificationPermission(deniedCanAsk, true, true)).toBe(true);
    expect(shouldRequestNotificationPermission(undetermined, true, true)).toBe(true);
  });
});
