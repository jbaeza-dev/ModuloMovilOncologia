import { Alert } from 'react-native';

/**
 * Aviso antes de que un reporte salga del teléfono (decisión del 24-11-2026): el PDF y el Excel
 * incluyen el nombre y el RUT del paciente para que su equipo tratante pueda archivarlos.
 */
export const IDENTIFIED_SHARE_NOTICE = {
  title: 'Compartir reporte',
  message: 'Este reporte incluye tu nombre y RUT. Compártelo solo con tu equipo de salud.',
  confirm: 'Compartir',
  cancel: 'Cancelar',
} as const;

/** Resuelve `true` solo si el paciente confirma; cancelar o cerrar el aviso no comparte nada. */
export function confirmIdentifiedShare(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      IDENTIFIED_SHARE_NOTICE.title,
      IDENTIFIED_SHARE_NOTICE.message,
      [
        { text: IDENTIFIED_SHARE_NOTICE.cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: IDENTIFIED_SHARE_NOTICE.confirm, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
