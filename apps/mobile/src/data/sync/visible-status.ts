export function clinicalStatusLabel(status: string | null): string {
  switch (status) {
    case 'pendiente':
    case 'enviando':
    case 'error_reintentable':
      return 'Guardado · Pendiente de envío';
    case 'pausado':
    case 'requiere_sesion':
      return 'Envío pausado · Conservado en este dispositivo';
    case 'aceptado':
      return 'Enviado al Médico';
    case 'rechazado':
    case 'conflicto':
      return 'Rechazado · Registro conservado';
    case 'enviado':
      return 'Enviado · Registro anterior';
    default:
      return 'Guardado en este dispositivo';
  }
}
