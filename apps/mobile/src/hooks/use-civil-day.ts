import { agendaDate, agendaInstant, shiftAgendaDate } from '@quimiocare/contracts/agenda';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Margen tras la medianoche para que el día nuevo ya esté vigente al despertar el temporizador. */
const AFTER_MIDNIGHT_MS = 250;
/** Los temporizadores de JavaScript no admiten esperas mayores que este valor. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Fecha de hoy en Chile (America/Santiago, la misma zona de la agenda y los formularios), que se
 * actualiza sola: a la medianoche siguiente, aunque la app siga abierta, y al volver del segundo
 * plano, por si el temporizador no alcanzó a ejecutarse mientras la app estaba suspendida.
 */
export function useCivilDay(): string {
  const [day, setDay] = useState(() => agendaDate(Date.now()));
  useEffect(() => {
    const next = Date.parse(agendaInstant(shiftAgendaDate(day, 1), '00:00'));
    const wait = Math.min(MAX_TIMEOUT_MS, Math.max(0, next - Date.now()) + AFTER_MIDNIGHT_MS);
    const timer = setTimeout(() => setDay(agendaDate(Date.now())), wait);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDay(agendaDate(Date.now()));
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [day]);
  return day;
}
