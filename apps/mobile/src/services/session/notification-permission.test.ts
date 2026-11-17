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
  });

  it('la primera vez (sin respuesta previa) lo pide también de forma automática', () => {
    expect(shouldRequestNotificationPermission(undetermined, false)).toBe(true);
  });

  it('si fue rechazado, el registro automático no vuelve a mostrar el diálogo', () => {
    expect(shouldRequestNotificationPermission(deniedCanAsk, false)).toBe(false);
    expect(shouldRequestNotificationPermission(deniedFixed, false)).toBe(false);
  });

  it('si fue rechazado, un botón lo vuelve a pedir solo cuando Android aún lo permite', () => {
    expect(shouldRequestNotificationPermission(deniedCanAsk, true)).toBe(true);
    expect(shouldRequestNotificationPermission(deniedFixed, true)).toBe(false);
  });
});
