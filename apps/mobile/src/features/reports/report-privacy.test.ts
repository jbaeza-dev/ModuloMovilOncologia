import { describe, expect, it } from 'vitest';
import { shareableReportSnapshot } from './report-privacy';
import { buildReportHtml, type GenerateReportParams } from './report-template';
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
describe('privacidad equivalente en archivo y lectura accesible', () => {
  it('omite perfil/código y metadatos personales de tratamiento sin alterar el dato original', () => {
    const snapshot = shareableReportSnapshot(data);
    const encoded = JSON.stringify(snapshot);
    for (const value of [
      'PERSONAL_NAME_SENTINEL',
      'PERSONAL_RUT_SENTINEL',
      'PERSONAL_EMAIL_SENTINEL',
      'LINK_SECRET_SENTINEL',
      'NESTED_PERSONAL_SENTINEL',
      'clinical-record-id',
      'another-clinical-id',
    ])
      expect(encoded).not.toContain(value);
    expect(data.profile?.nombre).toBe('PERSONAL_NAME_SENTINEL');
    expect(snapshot.vitals[0].dolor_ena).toBe(0);
    expect(snapshot.pacienteId).toBe('synthetic-minimal-id');
    expect(snapshot.treatment?.nombre).toBe('Tratamiento sintético');
  });
  it('mantiene información clínica y ENA cero en el PDF sin reintroducir identidad', () => {
    const html = buildReportHtml(shareableReportSnapshot(data));
    expect(html).toContain('Tratamiento sintético');
    expect(html).toContain('0/10');
    for (const value of [
      'PERSONAL_NAME_SENTINEL',
      'PERSONAL_RUT_SENTINEL',
      'PERSONAL_EMAIL_SENTINEL',
      'LINK_SECRET_SENTINEL',
    ])
      expect(html).not.toContain(value);
  });
});
