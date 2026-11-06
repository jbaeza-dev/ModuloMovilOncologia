import type { ReportData } from '../../data/local/reports/report-types';
import type { GenerateReportParams } from './report-template';

/** Same privacy policy for the exported file and its accessible companion.
 * Free text remains user-authored and must be reviewed before explicit sharing. */
export function shareableReportSnapshot<T extends ReportData | GenerateReportParams>(data: T): T {
  return {
    ...data,
    profile: null,
    linkingCode: {
      status: 'unavailable' as const,
      displayText: 'Código omitido en el reporte',
      code: null,
      expiresAt: null,
      obtainedAt: null,
    },
    treatment: data.treatment
      ? {
          ...data.treatment,
          parametros_json: null,
          id: '',
          paciente_id: '',
        }
      : null,
  } as unknown as T;
}
