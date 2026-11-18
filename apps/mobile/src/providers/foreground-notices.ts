import * as Notifications from 'expo-notifications';

// Decide si un aviso que llega con la app abierta se muestra. LocalDataProvider instala la consulta
// a las preferencias del paciente activo; sin paciente, los avisos se muestran.
let checkForegroundNoticesEnabled: () => Promise<boolean> = async () => true;

export function setForegroundNoticesCheck(check: () => Promise<boolean>): void {
  checkForegroundNoticesEnabled = check;
}

export function resetForegroundNoticesCheck(): void {
  checkForegroundNoticesEnabled = async () => true;
}

export function foregroundNoticesAllowed(): Promise<boolean> {
  return checkForegroundNoticesEnabled().catch(() => true);
}

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const allowed = await foregroundNoticesAllowed();
      return {
        shouldShowBanner: allowed,
        shouldShowList: allowed,
        shouldPlaySound: allowed,
        shouldSetBadge: false,
      };
    },
  });
} catch {
  // Entornos de prueba o sin soporte nativo
}
