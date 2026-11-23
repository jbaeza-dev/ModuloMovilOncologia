import type { SessionSnapshot } from '../../services/session/http-session-types';
import { isRecoverableSessionPause } from '../../data/sync/session-pause';
export interface SyncSummary {
  pending: number;
  /** Pausados por la sesión: detienen la cola hasta que la sesión vuelva a permitir envíos. */
  paused: number;
  /** Apartados por un error técnico: no detienen la cola y esperan la decisión del paciente. */
  setAside?: number;
  /** Rechazados por el servidor (excluye los que el paciente decidió conservar en el teléfono). */
  rejected: number;
  /** Conservados solo en el teléfono por decisión del paciente. */
  kept?: number;
  runtimePaused: boolean;
  pauseCode?: string | null;
}
export type SyncAction = 'details' | 'retry' | 'login' | 'consent' | 'profile' | 'link';
export function syncPresentation(
  snapshot: SessionSnapshot,
  summary: SyncSummary | null,
): {
  title: string;
  message: string;
  action: SyncAction;
  label: string;
} | null {
  if (!snapshot.user) return null;
  if (snapshot.state === 'expired')
    return {
      title: 'Tus registros están guardados',
      message:
        'Necesitas volver a ingresar para continuar enviándolos. Lo que guardaste sigue en este teléfono.',
      action: 'login',
      label: 'Volver a ingresar',
    };
  if (snapshot.state === 'terms_pending')
    return {
      title: 'Revisa tu consentimiento',
      message:
        'Tus registros se conservan en este teléfono. Revisa los términos vigentes para decidir si autorizas su envío.',
      action: 'consent',
      label: 'Revisar consentimiento',
    };
  if (snapshot.state === 'profile_incomplete')
    return {
      title: 'Completa tus datos',
      message: 'Falta completar tu información para habilitar los envíos.',
      action: 'profile',
      label: 'Completar mis datos',
    };
  if (snapshot.state === 'access_denied')
    return {
      title: 'Tu acceso necesita revisión',
      message:
        'No podemos enviar registros con los permisos actuales de esta cuenta. Tus datos siguen guardados.',
      action: 'details',
      label: 'Ver detalles',
    };
  if (snapshot.state === 'clinical_incomplete' && !snapshot.stale)
    return {
      title: 'Tu tratamiento está pendiente de vinculación',
      message:
        'Puedes seguir registrando y consultar tu historia. Revisa la vinculación con tu equipo de salud.',
      action: 'link',
      label: 'Revisar vinculación',
    };
  if (summary?.setAside)
    return {
      title:
        summary.setAside === 1
          ? 'Un registro no se pudo enviar'
          : `${summary.setAside} registros no se pudieron enviar`,
      message:
        'Se conservan en tu teléfono. Los demás registros siguen enviándose. Puedes reintentar el envío o conservarlos solo en este teléfono.',
      action: 'details',
      label: 'Revisar registros',
    };
  if (summary?.runtimePaused && summary.pauseCode && !isRecoverableSessionPause(summary.pauseCode))
    return {
      title: 'Un registro necesita revisión',
      message:
        'Se conserva en tu teléfono. Necesitamos revisar el motivo antes de volver a enviarlo.',
      action: 'details',
      label: 'Ver registro y detalles',
    };
  if (snapshot.state === 'service_unavailable' || snapshot.stale || summary?.runtimePaused)
    return {
      title: 'Guardado en este teléfono',
      message:
        'La app intentará recuperar la conexión y enviar lo pendiente automáticamente. Puedes seguir usando tus datos guardados.',
      action: 'retry',
      label: 'Intentar ahora',
    };
  if (!summary) return null;
  const waiting = summary.pending + summary.paused;
  if (summary.rejected > 0)
    return {
      title: 'Hay registros para revisar',
      message: `${summary.rejected} ${summary.rejected === 1 ? 'registro no fue aceptado' : 'registros no fueron aceptados'} por el servidor. Se conservan en tu historial.${waiting ? ` Hay ${waiting} por enviar.` : ''}`,
      action: 'details',
      label: 'Ver registros',
    };
  return {
    title: 'Tus registros',
    message: waiting
      ? `${waiting} ${waiting === 1 ? 'registro guardado' : 'registros guardados'} por enviar. Se enviarán automáticamente cuando haya conexión y permisos vigentes.`
      : 'No tienes registros pendientes de envío.',
    action: 'details',
    label: 'Ver estado de mis registros',
  };
}
