/**
 * Límites de la biblioteca educativa en el teléfono. Deben alcanzar para todas las infografías del
 * catálogo (42 imágenes, 76,6 MB según el servidor el 25-11-2026): las de urgencias tienen que
 * poder verse sin conexión.
 */
export const EDUCATION_MAX_COPIES = 100;
export const EDUCATION_MAX_MEGABYTES = 100;
export const EDUCATION_MAX_BYTES = EDUCATION_MAX_MEGABYTES * 1024 * 1024;

/** Una guía expulsada por cupo solo se recupera si todas caben; si no, se borraría otra vez. */
export function canRestoreEvictedCopies(
  catalogCount: number,
  copies: readonly { tamanoBytes?: number | null }[],
): boolean {
  const bytes = copies.reduce((total, copy) => total + (copy.tamanoBytes ?? 0), 0);
  return (
    Math.max(catalogCount, copies.length) <= EDUCATION_MAX_COPIES && bytes <= EDUCATION_MAX_BYTES
  );
}
