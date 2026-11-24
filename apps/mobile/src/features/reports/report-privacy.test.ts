import { describe, expect, it } from 'vitest';
import { shareableReportSnapshot } from './report-privacy';
import { buildReportHtml, type GenerateReportParams } from './report-template';
import { buildReportWorkbook } from './report-xlsx';
import type { ReportData } from '../../data/local/reports/report-types';
const data: GenerateReportParams = {
  pacienteId: 'synthetic-minimal-id',
  periodDays: 30,
  profile: {
    paciente_id: 'synthetic-minimal-id',
    nombre: 'PERSONAL_NAME_SENTINEL',
    rut: 'PERSONAL_RUT_SENTINEL',
    email: 'PERSONAL_EMAIL_SENTINEL',
    obtenido_en: '2026-11-02T12:00:00Z',
  },
  linkingCode: {
    status: 'cached_pending',
    code: 'LINK_SECRET_SENTINEL',
    displayText: 'LINK_SECRET_SENTINEL',
    obtainedAt: null,
    expiresAt: null,
  },
  treatment: {
    id: 'clinical-record-id',
    paciente_id: 'another-clinical-id',
    tipo: 'quimioterapia',
    nombre: 'Tratamiento sintético',
    estado: 'activo',
    parametros_json: '{"patientName":"NESTED_PERSONAL_SENTINEL"}',
    fecha_inicio: null,
    fecha_termino: null,
    obtenido_en: '2026-11-02T12:00:00Z',
  },
  summary: { total: 1 },
  vitals: [
    {
      id: 'vital',
      paciente_id: 'synthetic-minimal-id',
      fecha_registro: '2026-11-02T12:00:00Z',
      fecha_subida: null,
      temperatura: 36.5,
      presion_sistolica: null,
      presion_diastolica: null,
      pulso: null,
      saturacion_o2: null,
      dolor_ena: 0,
    },
  ],
};
// Decisión del 24-11-2026: el reporte identifica al paciente con nombre y RUT para que el equipo
// tratante lo archive en la ficha correcta; correo, código de vinculación e identificadores internos
// nunca salen del teléfono. PDF, Excel y lectura accesible aplican la misma política.
const omitted = [
  'PERSONAL_EMAIL_SENTINEL',
  'LINK_SECRET_SENTINEL',
  'NESTED_PERSONAL_SENTINEL',
  'clinical-record-id',
  'another-clinical-id',
];
describe('privacidad equivalente en archivo y lectura accesible', () => {
  it('conserva nombre y RUT, y omite correo, código y metadatos internos sin alterar el original', () => {
    const snapshot = shareableReportSnapshot(data);
    const encoded = JSON.stringify(snapshot);
    for (const value of omitted) expect(encoded).not.toContain(value);
    expect(snapshot.profile).toEqual({
      paciente_id: 'synthetic-minimal-id',
      nombre: 'PERSONAL_NAME_SENTINEL',
      rut: 'PERSONAL_RUT_SENTINEL',
      email: null,
      obtenido_en: '2026-11-02T12:00:00Z',
    });
    expect(data.profile?.email).toBe('PERSONAL_EMAIL_SENTINEL');
    expect(snapshot.vitals[0].dolor_ena).toBe(0);
    expect(snapshot.pacienteId).toBe('synthetic-minimal-id');
    expect(snapshot.treatment?.nombre).toBe('Tratamiento sintético');
  });

  it('el PDF aplica la política aunque reciba los datos completos', () => {
    const html = buildReportHtml(data);
    expect(html).toContain('PERSONAL_NAME_SENTINEL');
    expect(html).toContain('PERSONAL_RUT_SENTINEL');
    expect(html).toContain('Tratamiento sintético');
    expect(html).toContain('0/10');
    for (const value of omitted) expect(html).not.toContain(value);
  });

  it('el Excel aplica la misma política', () => {
    const encoded = JSON.stringify(buildReportWorkbook(data as ReportData));
    expect(encoded).toContain('PERSONAL_NAME_SENTINEL');
    expect(encoded).toContain('PERSONAL_RUT_SENTINEL');
    for (const value of omitted) expect(encoded).not.toContain(value);
  });

  it('sin RUT dice «No informado», no que el paciente no lo registró', () => {
    const withoutRut = { ...data, profile: { ...data.profile!, rut: null } };
    expect(buildReportHtml(withoutRut)).toContain(
      '<span class="meta-label">RUT:</span> No informado',
    );
    expect(buildReportHtml(withoutRut)).not.toContain('Sin registrar');
    const encoded = JSON.stringify(buildReportWorkbook(withoutRut as ReportData));
    expect(encoded).toContain('No informado');
    expect(encoded).not.toContain('Sin registrar');
  });
});
