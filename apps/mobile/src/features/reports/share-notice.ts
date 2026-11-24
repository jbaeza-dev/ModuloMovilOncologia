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

interface ShareContextSource {
  getPatientId?: () => string | null;
  getContextEpoch?: () => number;
}

/** Recuerda el paciente y la sesión activos; la función indica si siguen siendo los mismos. */
export function captureShareContext(
  manager: ShareContextSource | null | undefined,
  patientId: string | null,
): () => boolean {
  const read = () => [manager?.getPatientId?.() ?? patientId, manager?.getContextEpoch?.() ?? 0];
  const [patient, epoch] = read();
  return () => {
    const [currentPatient, currentEpoch] = read();
    return currentPatient === patient && currentEpoch === epoch;
  };
}

/** Resuelve `true` solo si el paciente confirma; y la cuenta no cambió mientras tanto. */
export function confirmIdentifiedShare(isCurrent: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      IDENTIFIED_SHARE_NOTICE.title,
      IDENTIFIED_SHARE_NOTICE.message,
      [
        { text: IDENTIFIED_SHARE_NOTICE.cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: IDENTIFIED_SHARE_NOTICE.confirm, onPress: () => resolve(isCurrent()) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
