/**
 * Generaciones de PDF en curso, compartidas entre «Mis reportes» y el visor.
 *
 * «Mis reportes» inicia la generación y abre el visor de inmediato con el identificador del
 * trabajo; el visor prepara pdf.js mientras el PDF se imprime y lo muestra al terminar
 * (RNF-06). Cada trabajo queda ligado al paciente que lo inició y solo se conservan los
 * más recientes.
 */
export interface PdfJobResult {
  persistentUri: string;
  filename: string;
}

interface PdfJob {
  patientId: string;
  promise: Promise<PdfJobResult>;
}

const MAX_JOBS = 3;
const jobs = new Map<string, PdfJob>();
let sequence = 0;

export function startPdfJob(patientId: string, run: () => Promise<PdfJobResult>) {
  sequence += 1;
  const id = `pdf-${Date.now()}-${sequence}`;
  const promise = run();
  // El rechazo lo atienden quienes esperan el trabajo; aquí solo se evita el aviso global.
  promise.catch(() => undefined);
  jobs.set(id, { patientId, promise });
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
  return { id, promise };
}

/** Entrega el trabajo solo al mismo paciente que lo inició. */
export function getPdfJob(id: string | null | undefined, patientId: string | null | undefined) {
  if (!id || !patientId) return null;
  const job = jobs.get(id);
  return job && job.patientId === patientId ? job.promise : null;
}

export function clearPdfJobs() {
  jobs.clear();
}
