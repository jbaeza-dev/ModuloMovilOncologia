import { ApiError } from './errors.js';

let maintenance = false;
let active = 0;
export const isMaintenanceActive = () => maintenance;
export const getActivePublishes = () => active;
export function setMaintenanceActive(value: boolean) {
  maintenance = value;
}
/** Register synchronously, before the first asynchronous operation. */
export function enterMutation(): () => void {
  if (maintenance) throw new ApiError(503, 'SERVICIO_NO_DISPONIBLE', 'Respaldo en curso.');
  active++;
  let finished = false;
  return () => {
    if (!finished) {
      finished = true;
      active--;
    }
  };
}
export async function drainPublishes(timeoutMs = 15000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (active) {
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}
