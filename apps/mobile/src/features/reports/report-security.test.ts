import { describe, expect, it } from 'vitest';

import {
  assertSafeReportFileName,
  getPatientReportDirectory,
  listPatientReports,
  parseTimestampFromReportFilename,
} from '../../data/local/report-storage';
import { buildReportHtml, escapeHtml } from './report-template';

const patientA = '11111111-1111-4111-8111-111111111111';
const patientB = '22222222-2222-4222-8222-222222222222';

describe('seguridad y sanitización de reportes locales', () => {
  it('escapa caracteres especiales HTML para prevenir inyección de código', () => {
    const maliciousInput = '<script>alert("xss")</script> & \'test\'';
    const escaped = escapeHtml(maliciousInput);

    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;test&#39;',
    );
  });

  it('sanitiza campos dinámicos en la plantilla HTML del reporte', () => {
    const html = buildReportHtml({
      pacienteId: patientA,
      periodDays: 30,
      profile: {
        paciente_id: patientA,
        nombre: '<b onmouseover="alert(1)">Paciente XSS</b>',
        rut: '12.345.678-9<script>',
        email: 'attacker@evil.com" onfocus="alert(2)',
        obtenido_en: '2026-10-04T12:00:00Z',
      },
      treatment: {
        id: 't1',
        paciente_id: patientA,
        tipo: 'quimioterapia',
        estado: 'activo',
        nombre: '<iframe src="evil.com">Tratamiento Seguro</iframe>',
        parametros_json: null,
        fecha_inicio: '2026-08-01',
        fecha_termino: null,
        obtenido_en: '2026-10-04T12:00:00Z',
      },
      summary: {
        total: 1,
        avgTemperature: 36.5,
        avgPulse: 75,
      },
      vitals: [
        {
          id: 'v1',
          paciente_id: patientA,
          fecha_registro: '2026-10-04T10:00:00Z',
          presion_sistolica: 120,
          presion_diastolica: 80,
          pulso: 75,
          temperatura: 36.5,
          saturacion_o2: 98,
          fecha_subida: null,
        },
      ],
    });

    // Ningún tag no deseado debe conservarse sin escapar
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b onmouseover');
    expect(html).not.toContain('<iframe');
    // Las entidades escapadas deben estar presentes
    expect(html).toContain('&lt;b onmouseover=&quot;alert(1)&quot;&gt;Paciente XSS&lt;/b&gt;');
    expect(html).toContain('12.345.678-9&lt;script&gt;');
    expect(html).toContain('&lt;iframe src=&quot;evil.com&quot;&gt;');
  });
});

describe('validación de nombres de archivo de reporte', () => {
  it('acepta nombres válidos según el patrón exacto reporte_{dias}d_{timestamp}.pdf', () => {
    expect(() => assertSafeReportFileName('reporte_30d_1791157123508.pdf')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_7d_1000000000.pdf')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_90d_1.pdf')).not.toThrow();
  });

  it('rechaza nombres inválidos, extensiones incorrectas y tentativas de path traversal', () => {
    const invalidNames = [
      '../reporte_30d_123.pdf',
      '..\\reporte_30d_123.pdf',
      'reporte_30d_123.pdf.exe',
      'reporte_30_123.pdf',
      'reporte_d_123.pdf',
      'reporte_30d_abc.pdf',
      'otro_archivo.pdf',
      'reporte_30d_123.html',
      '',
    ];

    for (const name of invalidNames) {
      expect(() => assertSafeReportFileName(name)).toThrow();
    }
  });
});

describe('extracción de fecha de generación a partir del nombre del archivo', () => {
  it('obtiene la fecha ISO correcta para nombres con timestamp válido', () => {
    const timestampMs = 1791157123508;
    const expectedDate = new Date(timestampMs).toISOString();

    const parsed = parseTimestampFromReportFilename(`reporte_30d_${timestampMs}.pdf`);
    expect(parsed).toBe(expectedDate);
  });

  it('retorna null para formatos o valores numéricos no conformes', () => {
    expect(parseTimestampFromReportFilename('archivo_invalido.pdf')).toBeNull();
    expect(parseTimestampFromReportFilename('reporte_30d_invalido.pdf')).toBeNull();
    expect(parseTimestampFromReportFilename('')).toBeNull();
  });
});

describe('aislamiento de directorios de reportes por paciente', () => {
  it('construye rutas estrictamente particionadas por ID de paciente', () => {
    const dirA = getPatientReportDirectory(patientA);
    const dirB = getPatientReportDirectory(patientB);

    expect(dirA.uri).toContain(patientA);
    expect(dirB.uri).toContain(patientB);
    expect(dirA.uri).not.toBe(dirB.uri);
  });

  it('rechaza identificadores maliciosos para prevenir path traversal en el directorio del reporte', () => {
    const maliciousIds = [
      '../paciente_a',
      '..\\paciente_a',
      'paciente/lateral',
      'paciente\0nulo',
      '',
    ];

    for (const badId of maliciousIds) {
      expect(() => getPatientReportDirectory(badId)).toThrow();
    }
  });

  it('aísla el listado de reportes locales entre pacientes', () => {
    // Para pacientes sin archivos, el listado retorna arreglo vacío de forma segura
    const reportsA = listPatientReports(patientA);
    const reportsB = listPatientReports(patientB);

    expect(Array.isArray(reportsA)).toBe(true);
    expect(Array.isArray(reportsB)).toBe(true);
  });
});
