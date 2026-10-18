import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { deletePatientReport } from '../../data/local/files/report-storage';
import type { ReportData } from '../../data/local/reports/report-types';
import { buildReportHtml, formatReportDate } from './report-template';
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

  it('regresión: conserva exactamente 3 hojas en el libro y mantiene el historial de síntomas sin alterar el contrato de exportación', () => {
    const data = createMockReportData({
      symptoms: [
        {
          id: 'symp-legacy-1',
          paciente_id: patientId,
          fecha_registro: '2026-10-10T12:00:00.000Z',
          descripcion: 'Molestia digestiva histórica',
          fecha_subida: null,
        },
      ],
    });
    const wb = buildReportWorkbook(data);
    expect(wb.SheetNames).toHaveLength(3);
    expect(wb.SheetNames).toEqual(['Resumen', 'Signos vitales', 'Sintomas']);
    expect(wb.SheetNames).not.toContain('Seguimiento');
    expect(wb.SheetNames).not.toContain('Formularios');

    // Verificar que la hoja de síntomas contiene el dato histórico
    const ws = wb.Sheets['Sintomas'];
    const rowContent = JSON.stringify(ws);
    expect(rowContent).toContain('Molestia digestiva histórica');
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

  it('mantiene paridad exhaustiva de contenido entre PDF y XLSX verificando todos los registros, conteos y metadatos', () => {
    const data = createMockReportData();

    // 1. Verificar HTML generado para PDF
    const html = buildReportHtml(data);
    expect(html).toContain(data.profile!.nombre);
    expect(html).toContain(data.profile!.rut);
    expect(html).toContain(data.treatment!.nombre);
    expect(html).toContain(data.linkingCode.displayText);
    expect(html).toContain('en caché · obtenida el');
    expect(html).toContain('36,6 °C');
    expect(html).toContain('72 lpm');
    expect(html).toContain('Náuseas moderadas');
    expect(html).toContain('Cansancio intenso');

    // 2. Verificar XLSX generado y re-leído
    const bytes = generateReportXlsxBytes(data);
    const reReadWb = XLSX.read(bytes, { type: 'array' });

    const summarySheet = reReadWb.Sheets['Resumen'];
    const summaryText = JSON.stringify(summarySheet);
    expect(summaryText).toContain(data.profile!.nombre);
    expect(summaryText).toContain(data.profile!.rut);
    expect(summaryText).toContain(data.profile!.email);
    expect(summaryText).toContain(data.treatment!.nombre);
    expect(summaryText).toContain(data.linkingCode.displayText);
    expect(summaryText).toContain(data.pacienteId);
    expect(summaryText).toContain(data.periodStart);
    expect(summaryText).toContain(data.periodEnd);
    expect(summaryText).toContain(data.generatedAt);
    expect(summaryText).toContain(data.timeZone);

    // Hoja Signos vitales: verificar todos los registros de signos vitales por ID y mediciones
    const vitalsSheet = reReadWb.Sheets['Signos vitales'];
    const vitalsText = JSON.stringify(vitalsSheet);
    for (const v of data.vitals) {
      expect(vitalsText).toContain(v.id);
      expect(vitalsText).toContain(v.fecha_registro);
      expect(vitalsText).toContain(String(v.presion_sistolica));
      expect(vitalsText).toContain(String(v.presion_diastolica));
      expect(vitalsText).toContain(String(v.temperatura));
      expect(vitalsText).toContain(String(v.pulso));
    }

    // Hoja Síntomas: verificar todos los síntomas por ID y descripciones
    const symptomsSheet = reReadWb.Sheets['Sintomas'];
    expect(symptomsSheet['A2'].v).toBe(data.symptoms[0].id);
    expect(symptomsSheet['B2'].v).toBe(data.symptoms[0].fecha_registro);
    expect(symptomsSheet['D2'].v).toBe(data.symptoms[0].descripcion);
    expect(symptomsSheet['A3'].v).toBe(data.symptoms[1].id);
    expect(symptomsSheet['B3'].v).toBe(data.symptoms[1].fecha_registro);
    expect(symptomsSheet['D3'].v).toBe(data.symptoms[1].descripcion);
  });

  it('incorpora ID del registro, fecha local identificada con zona, fecha de vinculación y celdas vacías para mediciones ausentes', () => {
    const dataWithMissing = createMockReportData({
      timeZone: 'America/Santiago',
      vitals: [
        {
          id: 'vital-uuid-001',
          paciente_id: patientId,
          fecha_registro: '2026-10-10T14:30:00.000Z',
          presion_sistolica: null, // Ausente
          presion_diastolica: null, // Ausente
          pulso: 78,
          temperatura: 36.5,
          saturacion_o2: null, // Ausente
          fecha_subida: null,
        },
      ],
      symptoms: [
        {
          id: 'symptom-uuid-001',
          paciente_id: patientId,
          fecha_registro: '2026-10-10T15:00:00.000Z',
          descripcion: 'Cefalea leve',
          fecha_subida: null,
        },
      ],
    });

    const bytes = generateReportXlsxBytes(dataWithMissing);
    const reReadWb = XLSX.read(bytes, { type: 'array' });

    // 1. Resumen: fecha de obtención en caché y zona local
    const summarySheet = reReadWb.Sheets['Resumen'];
    const summaryJson = JSON.stringify(summarySheet);
    expect(summaryJson).toContain('Fecha de obtención en caché (UTC)');
    expect(summaryJson).toContain(dataWithMissing.linkingCode.obtainedAt);
    expect(summaryJson).toContain('Fecha de obtención local (America/Santiago)');

    // 2. Signos vitales: encabezados con ID y zona horaria
    const vitalsSheet = reReadWb.Sheets['Signos vitales'];
    expect(vitalsSheet['A1'].v).toBe('ID del registro');
    expect(vitalsSheet['B1'].v).toBe('Fecha y hora (UTC)');
    expect(vitalsSheet['C1'].v).toBe('Fecha local (America/Santiago)');

    // Fila 2: ID y fechas
    expect(vitalsSheet['A2'].v).toBe('vital-uuid-001');
    expect(vitalsSheet['B2'].v).toBe('2026-10-10T14:30:00.000Z');
    expect(vitalsSheet['C2'].v).toContain('2026');

    // Mediciones ausentes: las celdas D2 (sistólica), E2 (diastólica) y H2 (sat O2) NO deben tener texto '—'
    // En SheetJS, una celda nula no se define o no contiene texto '—'
    expect(vitalsSheet['D2']).toBeUndefined();
    expect(vitalsSheet['E2']).toBeUndefined();
    expect(vitalsSheet['H2']).toBeUndefined();

    // Mediciones presentes: F2 (pulso) y G2 (temperatura) son numéricas
    expect(vitalsSheet['F2'].t).toBe('n');
    expect(vitalsSheet['F2'].v).toBe(78);
    expect(vitalsSheet['G2'].t).toBe('n');
    expect(vitalsSheet['G2'].v).toBe(36.5);

    // 3. Síntomas: encabezados con ID y zona horaria
    const symptomsSheet = reReadWb.Sheets['Sintomas'];
    expect(symptomsSheet['A1'].v).toBe('ID del registro');
    expect(symptomsSheet['B1'].v).toBe('Fecha y hora (UTC)');
    expect(symptomsSheet['C1'].v).toBe('Fecha local (America/Santiago)');
    expect(symptomsSheet['A2'].v).toBe('symptom-uuid-001');
    expect(symptomsSheet['D2'].v).toBe('Cefalea leve');
  });

  it('etiqueta el código de vinculación explícitamente como histórico fuera de uso si su estado es usado o expirado', () => {
    // Caso 1: Código usado
    const dataUsed = createMockReportData({
      linkingCode: {
        status: 'cached_used',
        displayText: 'Código ya utilizado',
        code: 'VINC-1111',
        expiresAt: '2026-10-15T12:00:00.000Z',
        obtainedAt: '2026-10-01T12:00:00.000Z',
      },
    });
    const wbUsed = buildReportWorkbook(dataUsed);
    const summaryUsed = JSON.stringify(wbUsed.Sheets['Resumen']);
    expect(summaryUsed).toContain('código histórico fuera de uso - utilizado');

    // Caso 2: Código expirado
    const dataExpired = createMockReportData({
      linkingCode: {
        status: 'cached_expired',
        displayText: 'Código expirado',
        code: 'VINC-2222',
        expiresAt: '2026-10-05T12:00:00.000Z',
        obtainedAt: '2026-10-01T12:00:00.000Z',
      },
    });
    const wbExpired = buildReportWorkbook(dataExpired);
    const summaryExpired = JSON.stringify(wbExpired.Sheets['Resumen']);
    expect(summaryExpired).toContain('código histórico fuera de uso - expirado');

    // Caso 3: No disponible
    const dataUnavailable = createMockReportData({
      linkingCode: {
        status: 'unavailable',
        displayText: 'Sin código de vinculación',
        code: null,
        expiresAt: null,
        obtainedAt: null,
      },
    });
    const wbUnavailable = buildReportWorkbook(dataUnavailable);
    const summaryUnavailable = JSON.stringify(wbUnavailable.Sheets['Resumen']);
    expect(summaryUnavailable).toContain('No disponible');
  });

  it('reloj congelado: alterar el reloj del sistema tras capturar la instantánea no modifica la fecha de emisión en PDF ni en XLSX', () => {
    const fixedIso = '2026-10-04T12:30:00.000Z';
    const data = createMockReportData({
      generatedAt: fixedIso,
      timeZone: 'America/Santiago',
      periodStart: '2026-09-04T12:30:00.000Z',
      periodEnd: fixedIso,
    });

    const expectedLocal = formatReportDate(fixedIso, 'America/Santiago');

    // Cambiar el reloj a una fecha futura
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2032-05-20T00:00:00.000Z'));

    try {
      // 1. PDF HTML debe reflejar la fecha capturada en data.generatedAt, NO el reloj del sistema
      const html = buildReportHtml(data);
      expect(html).toContain(expectedLocal);
      expect(html).not.toContain('2032');

      // 2. XLSX debe reflejar la fecha capturada en data.generatedAt, NO el reloj del sistema
      const bytes = generateReportXlsxBytes(data);
      const reReadWb = XLSX.read(bytes, { type: 'array' });
      const summarySheet = reReadWb.Sheets['Resumen'];
      const summaryText = JSON.stringify(summarySheet);
      expect(summaryText).toContain(fixedIso);
      expect(summaryText).not.toContain('2032');
    } finally {
      vi.useRealTimers();
    }
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
