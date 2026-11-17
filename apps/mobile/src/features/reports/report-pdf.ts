import * as Print from 'expo-print';
import { shareableReportSnapshot } from './report-privacy';

import {
  persistReportPdf,
  type BinaryReportStorageAdapter,
} from '../../data/local/files/report-storage';
import type { ReportData } from '../../data/local/reports/report-types';
import { buildReportHtml, type GenerateReportParams } from './report-template';
import { PDF_PRINT_ATTEMPTS, PDF_PRINT_TIMEOUT_MS, retryOnTimeout } from './pdf-generation-jobs';
import { rememberRenderedPdf } from './rendered-pdf-cache';

export { buildReportHtml, type GenerateReportParams } from './report-template';

/**
 * Genera el documento PDF utilizando expo-print a partir de la instantánea común
 * del reporte del paciente, lo traslada de la caché al directorio persistente de reportes
 * y retorna la URI persistente junto al nombre del archivo.
 */
export async function generateAndPersistReportPdf(
  data: ReportData | GenerateReportParams,
  adapter?: BinaryReportStorageAdapter,
): Promise<{ persistentUri: string; filename: string }> {
  const html = buildReportHtml(data);
  // base64: el visor usa esta copia en memoria y no relee ni descifra el archivo guardado.
  // Con límite de tiempo y un reintento: la primera impresión tras instalar puede no responder.
  // Si ningún intento responde, el visor y «Mis reportes» muestran el error y se puede volver a
  // generar sin reiniciar la app.
  const printResult = await retryOnTimeout(
    () =>
      Print.printToFileAsync({
        html,
        base64: true,
      }),
    {
      attempts: PDF_PRINT_ATTEMPTS,
      timeoutMs: PDF_PRINT_TIMEOUT_MS,
      message: 'La generación del PDF no respondió. Vuelve a intentarlo.',
    },
  );
  const patientName = 'profile' in data && data.profile?.nombre ? data.profile.nombre : undefined;
  const result = await persistReportPdf(
    data.pacienteId,
    printResult.uri,
    data.periodDays,
    adapter,
    shareableReportSnapshot(data),
    patientName,
  );
  rememberRenderedPdf(result.persistentUri, data.pacienteId, printResult.base64);
  return result;
}
