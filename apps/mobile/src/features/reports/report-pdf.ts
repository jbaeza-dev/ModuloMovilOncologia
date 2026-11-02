import * as Print from 'expo-print';

import {
  persistReportPdf,
  type BinaryReportStorageAdapter,
} from '../../data/local/files/report-storage';
import type { ReportData } from '../../data/local/reports/report-types';
import { buildReportHtml, type GenerateReportParams } from './report-template';

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
  const printResult = await Print.printToFileAsync({
    html,
  });
  const result = await persistReportPdf(
    data.pacienteId,
    printResult.uri,
    data.periodDays,
    adapter,
    data,
  );
  return result;
}
