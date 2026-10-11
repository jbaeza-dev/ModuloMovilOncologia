import * as Print from 'expo-print';

import { persistReportPdf } from '../../data/local/files/report-storage';
import { buildReportHtml, type GenerateReportParams } from './report-template';

export { buildReportHtml, type GenerateReportParams } from './report-template';

/**
 * Genera el documento PDF utilizando expo-print a partir de los datos locales del paciente,
 * lo traslada de la caché al directorio persistente de reportes y retorna la URI persistente junto al nombre del archivo.
 */
export async function generateAndPersistReportPdf(
  params: GenerateReportParams,
): Promise<{ persistentUri: string; filename: string }> {
  const html = buildReportHtml(params);
  const printResult = await Print.printToFileAsync({
    html,
  });
  const result = await persistReportPdf(params.pacienteId, printResult.uri, params.periodDays);
  return result;
}
