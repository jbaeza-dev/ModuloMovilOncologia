import { migrations, type Migration } from '../../data/local/migrations';

/** Primera versión de la base con las tablas de la agenda compartida (migración 13). */
export const MIN_AGENDA_SCHEMA = 13;

/**
 * La tarea de avisos con la app cerrada abre la base sin migrarla, así que solo acepta versiones
 * que esta app conoce: desde la agenda compartida hasta su última migración. Una base más nueva
 * (por ejemplo, tras volver a un APK anterior) se rechaza para no leer tablas que no entiende.
 */
export function isSupportedAgendaSchema(
  version: number,
  available: readonly Migration[] = migrations,
): boolean {
  const latest = available.at(-1)?.version ?? 0;
  return Number.isInteger(version) && version >= MIN_AGENDA_SCHEMA && version <= latest;
}
