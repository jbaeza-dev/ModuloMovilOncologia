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

/**
 * Límite de cada intento de impresión con expo-print. En Android, la primera impresión después
 * de instalar la app puede no responder nunca (Redmi 13C, Android 14: se reprodujo 2 veces, y
 * los intentos siguientes funcionaron). Sin límite, el visor quedaba en «Generando el reporte
 * PDF…» y el botón de generar seguía bloqueado hasta reiniciar la app. Las generaciones medidas
 * tardaron menos de 1,3 s.
 */
export const PDF_PRINT_TIMEOUT_MS = 15_000;
/** Intentos de impresión: se reintenta solo cuando el intento anterior no respondió. */
export const PDF_PRINT_ATTEMPTS = 2;

export class TimeoutError extends Error {}

/** Rechaza con `TimeoutError(message)` si `promise` no termina en `ms` milisegundos. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Ejecuta `run` con límite de tiempo y lo repite solo si no respondió; cualquier otro error se
 * entrega de inmediato. Tras el último intento sin respuesta, rechaza con `TimeoutError`.
 */
export async function retryOnTimeout<T>(
  run: () => Promise<T>,
  { attempts, timeoutMs, message }: { attempts: number; timeoutMs: number; message: string },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(run(), timeoutMs, message);
    } catch (error) {
      if (!(error instanceof TimeoutError) || attempt >= attempts) throw error;
    }
  }
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
