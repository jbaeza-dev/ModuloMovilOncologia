import type {
  PatientProfileRecord,
  SymptomRecord,
  TreatmentRecord,
  VitalRecord,
} from '../../data/local/repository';
import { formatDate } from '../../data/local/repository';
import type { ReportLinkingCodeInfo } from '../../data/local/reports/report-types';

export type GenerateReportParams = {
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
  };
  vitals: readonly Readonly<VitalRecord>[];
  symptoms?: readonly Readonly<SymptomRecord>[];
};

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildReportHtml({
  periodDays,
  profile,
  treatment,
  linkingCode,
  summary,
  vitals,
  symptoms = [],
}: GenerateReportParams): string {
  const generatedAt = formatDate(new Date().toISOString());
  const patientName = escapeHtml(profile?.nombre ?? 'Paciente de prueba');
  const patientRut = escapeHtml(profile?.rut ?? 'Sin registro');
  const patientEmail = escapeHtml(profile?.email ?? 'Sin registro');
  const treatmentName = escapeHtml(treatment?.nombre ?? 'Tratamiento activo en seguimiento');

  const linkingText = linkingCode ? escapeHtml(linkingCode.displayText) : 'No registrado';

  const totalVitals = summary.vitalsCount ?? summary.total ?? 0;
  const totalSymptoms = summary.symptomsCount ?? symptoms.length;

  const vitalsRowsHtml = vitals.length
    ? vitals
        .map((v) => {
          const fecha = formatDate(v.fecha_registro);
          const temp = v.temperatura !== null ? `${v.temperatura.toLocaleString('es-CL')} °C` : '—';
          const pa =
            v.presion_sistolica !== null && v.presion_diastolica !== null
              ? `${v.presion_sistolica}/${v.presion_diastolica} mmHg`
              : '—';
          const pulso = v.pulso !== null ? `${v.pulso} lpm` : '—';
          const sat = v.saturacion_o2 !== null ? `${v.saturacion_o2} %` : '—';
          return `<tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px;">${fecha}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: center;">${temp}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: center;">${pa}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: center;">${pulso}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; text-align: center;">${sat}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #64748B;">No hay mediciones registradas en este período.</td></tr>`;

  const symptomsRowsHtml = symptoms.length
    ? symptoms
        .map((s) => {
          const fecha = formatDate(s.fecha_registro);
          const descripcion = escapeHtml(s.descripcion || '—');
          return `<tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; white-space: nowrap; width: 160px;">${fecha}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; white-space: pre-wrap; word-break: break-word;">${descripcion}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="2" style="padding: 16px; text-align: center; color: #64748B;">No hay síntomas registrados en este período.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Reporte de Signos Vitales y Síntomas — QuimioCare</title>
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
      margin-top: 8px;
      margin-bottom: 28px;
    }
    th {
      background-color: #0D9488;
      color: white;
      text-align: center;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    th:first-child {
      text-align: left;
    }
    tr {
      page-break-inside: avoid;
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
      .summary-card, .meta-grid, tr {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">QuimioCare</div>
    <div class="title">Resumen de Signos Vitales y Síntomas — Seguimiento de Quimioterapia</div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><span class="meta-label">Paciente:</span> ${patientName}</div>
    <div class="meta-item"><span class="meta-label">RUT:</span> ${patientRut}</div>
    <div class="meta-item"><span class="meta-label">Tratamiento:</span> ${treatmentName}</div>
    <div class="meta-item"><span class="meta-label">Período evaluado:</span> Últimos ${periodDays} días</div>
    <div class="meta-item"><span class="meta-label">Correo registrado:</span> ${patientEmail}</div>
    <div class="meta-item"><span class="meta-label">Fecha de emisión:</span> ${generatedAt}</div>
    <div class="meta-item"><span class="meta-label">Vinculación clínica:</span> ${linkingText} <em style="font-size: 11px; color: #64748B;">(en caché)</em></div>
  </div>

  <div class="disclaimer">
    <strong>Aviso técnico y demostrativo:</strong> Este documento contiene mediciones sintéticas guardadas localmente en este dispositivo móvil para la evaluación del proyecto de título. No constituye un diagnóstico médico ni reemplaza las indicaciones formales del equipo oncológico tratante.
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
      <div class="metric-value">${totalSymptoms}</div>
      <div class="metric-label">Síntomas reportados</div>
    </div>
  </div>

  <div class="section-title">Detalle cronológico de mediciones de signos vitales</div>
  <table>
    <thead>
      <tr>
        <th>Fecha y hora</th>
        <th>Temperatura</th>
        <th>Presión arterial</th>
        <th>Pulso</th>
        <th>Saturación O₂</th>
      </tr>
    </thead>
    <tbody>
      ${vitalsRowsHtml}
    </tbody>
  </table>

  <div class="section-title">Detalle cronológico de síntomas reportados</div>
  <table>
    <thead>
      <tr>
        <th style="width: 160px; text-align: left;">Fecha y hora</th>
        <th style="text-align: left;">Descripción del síntoma</th>
      </tr>
    </thead>
    <tbody>
      ${symptomsRowsHtml}
    </tbody>
  </table>

  <div class="footer">
    QuimioCare Móvil — Demostración y acompañamiento al paciente oncológico · Generado localmente sin conexión
  </div>
</body>
</html>`;
}
