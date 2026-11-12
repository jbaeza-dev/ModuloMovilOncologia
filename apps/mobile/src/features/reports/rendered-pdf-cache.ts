/**
 * Conserva en memoria, por una sola lectura, el PDF que se acaba de generar.
 *
 * El visor lo toma al abrirse y evita releer y descifrar el archivo recién guardado
 * (RNF-06). Solo guarda el último reporte, ligado a su ruta y a su paciente, y se vacía
 * al leerlo, de modo que el contenido en claro no permanece en memoria.
 */
interface RenderedPdf {
  uri: string;
  patientId: string;
  base64: string;
}

let lastRendered: RenderedPdf | null = null;

export function rememberRenderedPdf(uri: string, patientId: string, base64: string | undefined) {
  lastRendered = base64 ? { uri, patientId, base64 } : null;
}

/** Entrega el PDF solo si corresponde a la misma ruta y paciente; en cualquier caso lo descarta. */
export function takeRenderedPdf(
  uri: string | null | undefined,
  patientId: string | null | undefined,
) {
  const entry = lastRendered;
  lastRendered = null;
  if (!entry || !uri || !patientId) return null;
  return entry.uri === uri && entry.patientId === patientId ? entry.base64 : null;
}

export function clearRenderedPdf() {
  lastRendered = null;
}
