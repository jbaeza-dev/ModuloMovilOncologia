/**
 * Validador y formateador de RUT chileno (Módulo 11).
 */

/**
 * Limpia el RUT dejando solo dígitos y K (en mayúscula).
 */
export function cleanRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

/**
 * Calcula el dígito verificador para un cuerpo de RUT mediante Módulo 11.
 * Retorna '0' a '9' o 'K'.
 */
export function calculateDv(rutBody: string | number): string {
  const cleanBody = String(rutBody).replace(/\D/g, '');
  if (!cleanBody) return '';

  let sum = 0;
  let multiplier = 2;

  for (let i = cleanBody.length - 1; i >= 0; i--) {
    sum += parseInt(cleanBody.charAt(i), 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

/**
 * Valida si un RUT chileno es válido según el algoritmo Módulo 11.
 */
export function validateRut(rut: string): boolean {
  const cleaned = cleanRut(rut);
  if (cleaned.length < 2) return false;

  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);

  // Mínimo 1 millón (7 dígitos con dv) y máximo 99 millones (9 dígitos con dv)
  if (body.length < 6 || body.length > 8) return false;
  if (!/^\d+$/.test(body)) return false;

  const expectedDv = calculateDv(body);
  return dv === expectedDv;
}

/**
 * Formatea un RUT mientras el usuario escribe o de forma completa.
 * Ejemplos:
 * "12345678k" -> "12.345.678-K"
 * "1234567" -> "1.234.567"
 * "12" -> "12"
 */
export function formatRut(input: string): string {
  const cleaned = cleanRut(input);
  if (!cleaned) return '';

  // Si tiene al menos 2 caracteres, el último es el DV
  if (cleaned.length === 1) {
    return cleaned;
  }

  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1);

  // Formatear el cuerpo con separadores de miles (.)
  let formattedBody = '';
  let count = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    formattedBody = body.charAt(i) + formattedBody;
    count++;
    if (count % 3 === 0 && i > 0) {
      formattedBody = '.' + formattedBody;
    }
  }

  return `${formattedBody}-${dv}`;
}
