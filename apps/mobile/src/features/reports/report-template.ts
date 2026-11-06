import type {
  PatientProfileRecord,
  SymptomRecord,
  TreatmentRecord,
  VitalRecord,
} from '../../data/local/repository';
import { formatDate } from '../../data/local/repository';
import type {
  ReportData,
  ReportLinkingCodeInfo,
  ReportEproCapture,
} from '../../data/local/reports/report-types';
import { clinicalStatusLabel } from '../../data/sync/visible-status';

export type GenerateReportParams =
  | ReportData
  | {
      pacienteId: string;
      periodDays: number;
      profile: Readonly<PatientProfileRecord> | null;
      treatment: Readonly<TreatmentRecord> | null;
      linkingCode?: Readonly<ReportLinkingCodeInfo>;
      summary: {
        vitalsCount?: number;
        total?: number; // compatibilidad
        symptomsCount?: number;
        avgTemperature?: number | null;
        avgPulse?: number | null;
        avgSystolic?: number | null;
        avgDiastolic?: number | null;
        avgOxygenSaturation?: number | null;
        avgPain?: number | null;
      };
      vitals: readonly Readonly<VitalRecord>[];
      symptoms?: readonly Readonly<SymptomRecord>[];
      generatedAt?: string;
      periodStart?: string;
      periodEnd?: string;
      timeZone?: string;
      epro?: readonly ReportEproCapture[];
      syncStatuses?: Readonly<Record<string, string>>;
    };

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatReportDate(iso: string, timeZone?: string): string {
  try {
    const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
    if (timeZone) {
      opts.timeZone = timeZone;
    }
    return new Date(iso).toLocaleString('es-CL', opts);
  } catch {
    return formatDate(iso);
  }
}

export function buildReportHtml(data: GenerateReportParams): string {
  const timeZone = 'timeZone' in data && data.timeZone ? data.timeZone : 'America/Santiago';
  const generatedAtIso =
    'generatedAt' in data && data.generatedAt ? data.generatedAt : new Date().toISOString();
  const generatedAt = formatReportDate(generatedAtIso, timeZone);

  const periodDays = data.periodDays;
  const summary = data.summary;
  const vitals = data.vitals;
  const epro = data.epro ?? [];
  const eproHtml = epro.length
    ? epro
        .map((capture) => {
          const rows = capture.answers
            .map(
              (a) => `<tr>
                <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 12px; vertical-align: top; width: 65%; color: #334155;">${escapeHtml(a.question || 'Pregunta')}</td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 12px; font-weight: 600; vertical-align: top; width: 35%; color: #0D9488;">${escapeHtml(a.value || '—')}</td>
              </tr>`,
            )
            .join('');

          return `<section class="epro-card" style="page-break-inside: avoid; break-inside: avoid; margin-bottom: 24px; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 16px; background-color: #F8FAFC;">
    <h3 style="margin: 0 0 6px 0; font-size: 15px; font-weight: 600; color: #0F172A;">${escapeHtml(capture.title)}</h3>
    <p style="margin: 0 0 12px 0; font-size: 12px; color: #64748B;">Fecha de respuesta: <strong style="color: #334155;">${escapeHtml(formatReportDate(capture.capturedAt, timeZone))}</strong> · Estado: <strong style="color: #0D9488;">${escapeHtml(clinicalStatusLabel(capture.status))}</strong></p>
    <table style="width: 100%; border-collapse: collapse; background: #FFFFFF; border-radius: 6px; overflow: hidden; margin: 0; table-layout: fixed;">
      <thead>
        <tr>
          <th style="padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; width: 65%;">Pregunta</th>
          <th style="padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; width: 35%;">Respuesta</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </section>`;
        })
        .join('')
    : '<p style="color: #64748B; font-size: 13px;">No hay seguimientos ePRO confirmados localmente en este período. Los borradores no se incluyen.</p>';
  const dictionaryHtml = '';

  const periodStartFormatted =
    'periodStart' in data && data.periodStart ? formatReportDate(data.periodStart, timeZone) : null;
  const periodEndFormatted =
    'periodEnd' in data && data.periodEnd ? formatReportDate(data.periodEnd, timeZone) : null;
  const periodDisplay =
    periodStartFormatted && periodEndFormatted
      ? `Últimos ${periodDays} días (${periodStartFormatted} – ${periodEndFormatted})`
      : `Últimos ${periodDays} días`;

  const totalVitals = summary.vitalsCount ?? ('total' in summary ? summary.total : undefined) ?? 0;
  const vitalsWithPain = vitals.filter((v) => v.dolor_ena !== null && v.dolor_ena !== undefined);
  const calculatedAvgPain =
    vitalsWithPain.length > 0
      ? Math.round(
          (vitalsWithPain.reduce((sum, v) => sum + (v.dolor_ena ?? 0), 0) / vitalsWithPain.length) *
            10,
        ) / 10
      : null;
  const avgPain =
    'avgPain' in summary && summary.avgPain !== undefined ? summary.avgPain : calculatedAvgPain;
  const avgPainText = avgPain !== null ? `${avgPain.toLocaleString('es-CL')} / 10` : '—';

  const vitalsRowsHtml = vitals.length
    ? vitals
        .map((v) => {
          const fecha = formatReportDate(v.fecha_registro, timeZone);
          const temp = v.temperatura !== null ? `${v.temperatura.toLocaleString('es-CL')} °C` : '—';
          const pa =
            v.presion_sistolica !== null || v.presion_diastolica !== null
              ? `${v.presion_sistolica ?? '—'}/${v.presion_diastolica ?? '—'} mmHg`
              : '—';
          const pulso = v.pulso !== null ? `${v.pulso} lpm` : '—';
          const pain = v.dolor_ena == null ? 'Sin registro' : `${v.dolor_ena}/10`;
          const sat = v.saturacion_o2 !== null ? `${v.saturacion_o2} %` : '—';
          return `<tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 12px; font-weight: 500;">${escapeHtml(fecha)}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: center;">${temp}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: center;">${pa}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: center;">${pulso}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: center;">${sat}</td>
            <td>${pain}</td>
            <td>${escapeHtml(clinicalStatusLabel(data.syncStatuses?.[v.id] ?? (v.fecha_subida ? 'enviado' : null)))}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #64748B;">No hay mediciones registradas en este período.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Reporte Clínico de Signos Vitales — QuimioCare</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 32px;
      color: #1E293B;
      line-height: 1.5;
    }
    .header {
      border-bottom: 2px solid #0D9488;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand {
      font-size: 22px;
      font-weight: 700;
      color: #0D9488;
      letter-spacing: -0.5px;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      margin-top: 4px;
      color: #0F172A;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 20px;
      background-color: #F8FAFC;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #E2E8F0;
      page-break-inside: avoid;
    }
    .meta-item {
      font-size: 13px;
    }
    .meta-label {
      font-weight: 600;
      color: #475569;
    }
    .disclaimer {
      background-color: #FEF3C7;
      border-left: 4px solid #D97706;
      padding: 12px 16px;
      border-radius: 4px;
      font-size: 12px;
      color: #92400E;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }
    .summary-card {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }
    .metric {
      flex: 1;
      padding: 12px;
      background-color: #F1F5F9;
      border-radius: 8px;
      text-align: center;
    }
    .metric-value {
      font-size: 18px;
      font-weight: 700;
      color: #0D9488;
    }
    .metric-label {
      font-size: 11px;
      color: #64748B;
      text-transform: uppercase;
      font-weight: 600;
      margin-top: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 8px;
      margin-bottom: 24px;
    }
    thead { display: table-header-group; }
    td { padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 11px; overflow-wrap: break-word; word-break: break-word; }
    th {
      background-color: #0D9488;
      color: white;
      text-align: center;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    th:first-child {
      text-align: left;
    }
    section, tr, .summary-card, .meta-grid, .epro-card {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .section-title {
      font-size: 15px;
      font-weight: 600;
      margin-top: 16px;
      margin-bottom: 8px;
      color: #334155;
    }
    .footer {
      border-top: 1px solid #E2E8F0;
      padding-top: 12px;
      font-size: 11px;
      color: #94A3B8;
      text-align: center;
    }
    @media print {
      body {
        margin: 16px;
      }
      .summary-card, .meta-grid, tr, section, .epro-card {
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">QuimioCare</div>
    <div class="title">Reporte Clínico de Signos Vitales y Seguimiento de Quimioterapia</div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><span class="meta-label">Paciente:</span> ${escapeHtml(data.profile?.nombre || 'Paciente en seguimiento')}</div>
    <div class="meta-item"><span class="meta-label">RUT:</span> ${escapeHtml(data.profile?.rut || 'Sin registrar')}</div>
    <div class="meta-item"><span class="meta-label">Tratamiento:</span> ${escapeHtml(data.treatment?.nombre ?? data.treatment?.tipo ?? 'En seguimiento oncológico')}</div>
    <div class="meta-item"><span class="meta-label">Período evaluado:</span> ${escapeHtml(periodDisplay)}</div>
    <div class="meta-item"><span class="meta-label">Fecha de emisión:</span> ${generatedAt}</div>
  </div>

  <div class="disclaimer">
    <strong>Aviso clínico:</strong> Este reporte contiene registros de salud informados por el paciente a través de la aplicación QuimioCare Móvil. Los datos sirven de apoyo al seguimiento del equipo tratante y no reemplazan la evaluación clínica directa ni las urgencias oncológicas.
  </div>

  <div class="summary-card">
    <div class="metric">
      <div class="metric-value">${totalVitals}</div>
      <div class="metric-label">Signos vitales</div>
    </div>
    <div class="metric">
      <div class="metric-value">${summary.avgTemperature !== null && summary.avgTemperature !== undefined ? summary.avgTemperature.toLocaleString('es-CL') + ' °C' : '—'}</div>
      <div class="metric-label">Temp. promedio</div>
    </div>
    <div class="metric">
      <div class="metric-value">${summary.avgPulse !== null && summary.avgPulse !== undefined ? summary.avgPulse + ' lpm' : '—'}</div>
      <div class="metric-label">Pulso promedio</div>
    </div>
    <div class="metric">
      <div class="metric-value">${avgPainText}</div>
      <div class="metric-label">Dolor ENA promedio</div>
    </div>
  </div>

  <div class="section-title">Detalle cronológico de mediciones de signos vitales</div>
  <table>
    <thead>
      <tr>
        <th>Fecha y hora (${escapeHtml(timeZone)})</th>
        <th>Temperatura</th>
        <th>Presión arterial</th>
        <th>Pulso</th>
        <th>Saturación O₂</th>
        <th>Dolor ENA (0–10)</th>
        <th>Estado de envío</th>
      </tr>
    </thead>
    <tbody>
      ${vitalsRowsHtml}
    </tbody>
  </table>

  <div class="section-title">Seguimientos ePRO (${epro.length})</div>
  <p>La recepción del servidor no implica revisión clínica. Los datos ausentes se muestran sin inferir valores.</p>
  ${eproHtml}
  ${dictionaryHtml}



  <div class="footer">
    QuimioCare Móvil — Demostración y acompañamiento al paciente oncológico · Generado localmente sin conexión
  </div>
</body>
</html>`;
}
