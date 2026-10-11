import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { deletePatientReport } from '../../data/local/files/report-storage';
import type { ReportData } from '../../data/local/reports/report-types';
import { buildReportHtml } from './report-template';
import {
  buildReportWorkbook,
  generateAndPersistReportXlsx,
  generateReportXlsxBytes,
  makeTextCell,
} from './report-xlsx';

const patientId = '11111111-1111-4111-8111-111111111111';

function createMockReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    pacienteId: patientId,
    periodDays: 30,
    generatedAt: '2026-10-11T12:00:00.000Z',
    timeZone: 'UTC',
    periodStart: '2026-09-11T12:00:00.000Z',
    periodEnd: '2026-10-11T12:00:00.000Z',
    profile: {
      paciente_id: patientId,
      nombre: 'María González',
      rut: '12.345.678-9',
      email: 'maria@example.com',
      obtenido_en: '2026-10-01T00:00:00.000Z',
    },
    treatment: {
      id: 'treat-1',
      paciente_id: patientId,
      tipo: 'quimioterapia',
      estado: 'activo',
      nombre: 'Ciclo AC-T',
      parametros_json: null,
      fecha_inicio: '2026-08-01',
      fecha_termino: null,
      obtenido_en: '2026-10-01T00:00:00.000Z',
    },
    linkingCode: {
      status: 'cached_pending',
      displayText: 'En espera de confirmación institucional',
      code: 'LINK-8899',
      expiresAt: '2026-10-15T12:00:00.000Z',
      obtainedAt: '2026-10-10T12:00:00.000Z',
    },
    summary: {
      vitalsCount: 2,
      symptomsCount: 2,
      avgTemperature: 36.6,
      avgPulse: 72,
      avgSystolic: 120,
      avgDiastolic: 80,
      avgOxygenSaturation: 98,
      minTemperature: 36.4,
      maxTemperature: 36.8,
      minPulse: 70,
      maxPulse: 74,
    },
    vitals: [
      {
        id: 'v1',
        paciente_id: patientId,
        fecha_registro: '2026-10-10T10:00:00.000Z',
        presion_sistolica: 120,
        presion_diastolica: 80,
        pulso: 70,
        temperatura: 36.4,
        saturacion_o2: 98,
        fecha_subida: null,
      },
      {
        id: 'v2',
        paciente_id: patientId,
        fecha_registro: '2026-10-11T10:00:00.000Z',
        presion_sistolica: 120,
        presion_diastolica: 80,
        pulso: 74,
        temperatura: 36.8,
        saturacion_o2: 98,
        fecha_subida: null,
      },
    ],
    symptoms: [
      {
        id: 's1',
        paciente_id: patientId,
        fecha_registro: '2026-10-10T14:00:00.000Z',
        descripcion: 'Náuseas moderadas tras la ingesta de alimentos.\nAliviadas con reposo.',
        fecha_subida: null,
      },
      {
        id: 's2',
        paciente_id: patientId,
        fecha_registro: '2026-10-11T09:00:00.000Z',
        descripcion: '=SUM(1,2) Cansancio intenso al subir escaleras @oncologia',
        fecha_subida: null,
      },
    ],
    ...overrides,
  };
}

describe('exportador de reportes Excel (.xlsx) con SheetJS', () => {
  it('genera un libro de trabajo con las tres hojas estructuradas requeridas', () => {
    const data = createMockReportData();
    const wb = buildReportWorkbook(data);

    expect(wb.SheetNames).toEqual(['Resumen', 'Signos vitales', 'Sintomas']);
    expect(wb.Sheets['Resumen']).toBeDefined();
    expect(wb.Sheets['Signos vitales']).toBeDefined();
    expect(wb.Sheets['Sintomas']).toBeDefined();
  });

  it('serializa a bytes válidos legibles por SheetJS sin corromper la estructura', () => {
    const data = createMockReportData();
    const bytes = generateReportXlsxBytes(data);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(5000); // Archivo ZIP/XLSX válido

    const reReadWb = XLSX.read(bytes, { type: 'array' });
    expect(reReadWb.SheetNames).toEqual(['Resumen', 'Signos vitales', 'Sintomas']);
  });

  it('garantiza que las celdas de texto sean estrictamente de tipo string (t: "s") y carezcan de propiedad de fórmula o enlace', () => {
    const dangerousText = '=1+1; EXEC sp_configure';
    const cell = makeTextCell(dangerousText);

    expect(cell.t).toBe('s');
    expect(cell.v).toBe(dangerousText);
    expect((cell as unknown as Record<string, unknown>).f).toBeUndefined();
    expect((cell as unknown as Record<string, unknown>).l).toBeUndefined();
  });

  it('preserva caracteres especiales (=, +, -, @) como texto literal sin anteponer comillas simples', () => {
    const data = createMockReportData();
    const bytes = generateReportXlsxBytes(data);
    const reReadWb = XLSX.read(bytes, { type: 'array' });

    const symptomsSheet = reReadWb.Sheets['Sintomas'];
    // Buscar la celda con la descripción que contiene '=SUM(1,2)'
    let foundCell: XLSX.CellObject | null = null;
    for (const key of Object.keys(symptomsSheet)) {
      if (key.startsWith('!')) continue;
      const cell = symptomsSheet[key];
      if (typeof cell.v === 'string' && cell.v.includes('=SUM(1,2)')) {
        foundCell = cell;
        break;
      }
    }

    expect(foundCell).not.toBeNull();
    expect(foundCell?.t).toBe('s');
    expect(foundCell?.v).toBe('=SUM(1,2) Cansancio intenso al subir escaleras @oncologia');
    // NO debe anteponer comillas simples adicionales en el valor
    expect((foundCell?.v as string).startsWith("'")).toBe(false);
    // NO debe existir fórmula calculada
    expect((foundCell as unknown as Record<string, unknown>)?.f).toBeUndefined();
  });

  it('mantiene paridad de contenido entre la plantilla PDF y el libro XLSX para la misma instantánea', () => {
    const data = createMockReportData();

    // 1. Verificar HTML generado para PDF
    const html = buildReportHtml(data);
    expect(html).toContain(data.profile!.nombre);
    expect(html).toContain(data.treatment!.nombre);
    expect(html).toContain(data.linkingCode.displayText);
    expect(html).toContain('36,6 °C');
    expect(html).toContain('Náuseas moderadas');

    // 2. Verificar XLSX generado
    const bytes = generateReportXlsxBytes(data);
    const reReadWb = XLSX.read(bytes, { type: 'array' });

    const summarySheet = reReadWb.Sheets['Resumen'];
    const summaryText = JSON.stringify(summarySheet);
    expect(summaryText).toContain(data.profile!.nombre);
    expect(summaryText).toContain(data.treatment!.nombre);
    expect(summaryText).toContain(data.linkingCode.displayText);

    const vitalsSheet = reReadWb.Sheets['Signos vitales'];
    const vitalsText = JSON.stringify(vitalsSheet);
    expect(vitalsText).toContain('36.4');
    expect(vitalsText).toContain('36.8');

    const symptomsSheet = reReadWb.Sheets['Sintomas'];
    const symptomsText = JSON.stringify(symptomsSheet);
    expect(symptomsText).toContain('Náuseas moderadas');
  });

  it('maneja listas vacías de signos vitales y síntomas con fila descriptiva en ambas hojas', () => {
    const emptyData = createMockReportData({
      vitals: [],
      symptoms: [],
      summary: {
        vitalsCount: 0,
        symptomsCount: 0,
        avgTemperature: null,
        avgPulse: null,
        avgSystolic: null,
        avgDiastolic: null,
        avgOxygenSaturation: null,
        minTemperature: null,
        maxTemperature: null,
        minPulse: null,
        maxPulse: null,
      },
    });

    const bytes = generateReportXlsxBytes(emptyData);
    const reReadWb = XLSX.read(bytes, { type: 'array' });

    const vitalsSheet = JSON.stringify(reReadWb.Sheets['Signos vitales']);
    expect(vitalsSheet).toContain('No hay mediciones registradas en el período evaluado.');

    const symptomsSheet = JSON.stringify(reReadWb.Sheets['Sintomas']);
    expect(symptomsSheet).toContain('No hay síntomas registrados en el período evaluado.');
  });

  it('persiste el archivo .xlsx generado a través de generateAndPersistReportXlsx', async () => {
    const data = createMockReportData();
    const result = await generateAndPersistReportXlsx(data);

    expect(result.persistentUri).toContain('.xlsx');
    expect(result.filename).toMatch(/^reporte_30d_\d+\.xlsx$/);

    // Limpieza
    await deletePatientReport(patientId, result.filename);
  });
});
