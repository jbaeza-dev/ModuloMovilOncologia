import type { createEproRepository } from '../../data/sync/epro-repository';
import { getCivilDateInTimeZone } from '../../services/forms/daily-form-context';

type Hub = Awaited<ReturnType<ReturnType<typeof createEproRepository>['hub']>>;

/** Local completion uses the original tracking day, independently of upload or legacy assignment. */
export function eproHomeDescription(hub: Hub | null, now = new Date()): string {
  if (!hub) return 'El seguimiento no está disponible en este contexto.';
  const today = getCivilDateInTimeZone(now);
  if (hub.captures.some((capture) => capture.context.fechaSeguimiento === today))
    return 'Seguimiento de hoy guardado. Revisa su estado de envío en el historial.';
  if (hub.drafts.some((draft) => draft.context.fechaSeguimiento === today))
    return 'Tienes un seguimiento en curso para hoy.';
  if (hub.drafts.length > 0)
    return 'Puedes continuar un seguimiento anterior con su fecha original.';
  if (!hub.status?.completed_at)
    return 'Conéctate para recibir una definición completa del seguimiento.';
  if (!hub.current) return 'No hay un seguimiento global activo disponible.';
  return 'Completa tu cuestionario diario de seguimiento.';
}
