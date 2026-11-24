import type { ReportData } from '../../data/local/reports/report-types';
import type { GenerateReportParams } from './report-template';

/**
 * Política de privacidad común del PDF, el Excel y su lectura accesible (decisión del 24-11-2026):
 * el reporte identifica al paciente con nombre y RUT para que el equipo tratante lo archive en la
 * ficha correcta; el correo, el código de vinculación y los identificadores internos nunca salen
 * del teléfono. El archivo solo sale cuando el paciente pulsa «Compartir», tras un aviso.
 * El texto libre es del paciente y debe revisarse antes de compartir.
 */
export function shareableReportSnapshot<T extends ReportData | GenerateReportParams>(data: T): T {
  return {
    ...data,
    profile: data.profile
      ? {
          paciente_id: data.profile.paciente_id,
          nombre: data.profile.nombre,
          rut: data.profile.rut,
          email: null,
          obtenido_en: data.profile.obtenido_en,
        }
      : null,
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
