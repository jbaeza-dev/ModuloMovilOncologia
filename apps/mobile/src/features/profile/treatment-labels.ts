/** Presentation only; contractual values and stored treatment data remain unchanged. */
export function readableTreatmentText(value: string): string {
  const text = value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toLocaleUpperCase('es') + text.slice(1) : 'Sin registro';
}
