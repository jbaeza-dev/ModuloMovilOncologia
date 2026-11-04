export type ReminderNotificationKind = 'signos' | 'epro' | 'medicacion';

/** Explica el motivo sin mostrar nombres, dosis, respuestas ni datos de la cuenta. */
export function reminderNotificationCopy(kind?: ReminderNotificationKind) {
  switch (kind) {
    case 'signos':
      return {
        title: 'Es hora de registrar tus signos vitales',
        body: 'Abre QuimioCare para guardar tu medición y dolor ENA.',
      };
    case 'epro':
      return {
        title: 'Recordatorio de seguimiento diario',
        body: 'Completa tu formulario de seguimiento domiciliario en QuimioCare.',
      };
    case 'medicacion':
      return {
        title: 'Recordatorio de medicamentos',
        body: 'Revisa en QuimioCare el medicamento y horario indicados por tu equipo.',
      };
    default:
      return {
        title: 'Recordatorio de QuimioCare',
        body: 'Abre la aplicación para revisar tu recordatorio.',
      };
  }
}
