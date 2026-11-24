import { describe, expect, it, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildReportWorkbook,
  generateReportXlsxBytes,
  generateAndPersistReportXlsx,
  makeTextCell,
} from './report-xlsx';
import { buildReportHtml } from './report-template';
import type { ReportData } from '../../data/local/reports/report-types';
import { activateFileCipher, readClinicalFile } from '../../data/sync/file-protection';
import {
  resolvePatientReportFile,
  deletePatientReport,
} from '../../data/local/files/report-storage';

const patientId = 'paciente-test-123';

function createMockReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    pacienteId: patientId,
    periodDays: 30,
    generatedAt: '2026-10-15T10:00:00.000Z',
    timeZone: 'America/Santiago',
    periodStart: '2026-09-15T10:00:00.000Z',
    periodEnd: '2026-10-15T10:00:00.000Z',
    profile: {
      paciente_id: patientId,
      nombre: 'María González',
      rut: '12.345.678-9',
      email: 'maria@example.com',
      obtenido_en: '2026-10-01T00:00:00.000Z',
    },
    treatment: {
      id: 'tx-001',
      paciente_id: patientId,
      tipo: 'quimioterapia_adyuvante',
      nombre: 'Protocolo AC-T',
      estado: 'activo',
      parametros_json: null,
      fecha_inicio: '2026-08-01',
      fecha_termino: '2026-12-01',
      obtenido_en: '2026-08-01T00:00:00.000Z',
    },
    linkingCode: {
      status: 'active_link',
      displayText: 'Vínculo activo: QC-9988',
      code: 'QC-9988',
      expiresAt: null,
      obtainedAt: '2026-08-01T00:00:00.000Z',
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
      avgPain: 3,
    },
    vitals: [
      {
        id: 'vital-1',
        paciente_id: patientId,
        fecha_registro: '2026-10-10T12:00:00.000Z',
        presion_sistolica: 120,
        presion_diastolica: 80,
        pulso: 70,
        temperatura: 36.4,
        saturacion_o2: 98,
        fecha_subida: '2026-10-10T12:05:00.000Z',
      },
      {
        id: 'vital-2',
        paciente_id: patientId,
        fecha_registro: '2026-10-11T13:00:00.000Z',
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
        id: 'symptom-1',
        paciente_id: patientId,
        fecha_registro: '2026-10-10T14:00:00.000Z',
        descripcion: 'Náuseas moderadas tras almuerzo',
        fecha_subida: '2026-10-10T14:05:00.000Z',
      },
      {
        id: 'symptom-2',
        paciente_id: patientId,
        fecha_registro: '2026-10-12T09:00:00.000Z',
        descripcion: '=SUM(1,2) Cansancio intenso al subir escaleras @oncologia',
        fecha_subida: null,
      },
    ],
    epro: [
      {
        id: 'epro-001',
        formId: 'seguimiento-diario-v1',
        version: '1.0.0',
        title: 'Seguimiento domiciliario diario',
        capturedAt: '2026-10-12T10:00:00.000Z',
        status: 'enviado',
        source: 'snapshot',
        answers: [
          {
            code: 'q1',
            question: '¿Has tenido náuseas?',
            value: 'Sí, leves',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('exportador de reportes Excel (.xlsx) con SheetJS', () => {
  it('genera un libro de trabajo con las tres hojas estructuradas requeridas (sin síntomas)', () => {
    const data = createMockReportData();
    const wb = buildReportWorkbook(data);

    expect(wb.SheetNames).toEqual(['Resumen', 'Signos vitales', 'Seguimientos ePRO']);
    expect(wb.Sheets['Resumen']).toBeDefined();
    expect(wb.Sheets['Signos vitales']).toBeDefined();
    expect(wb.Sheets['Seguimientos ePRO']).toBeDefined();
    expect(wb.Sheets['Sintomas']).toBeUndefined();
  });

  it('regresión: incluye ePRO y conserva las tres hojas en el libro omitiendo la hoja de síntomas', () => {
    const data = createMockReportData();
    const wb = buildReportWorkbook(data);
    expect(wb.SheetNames).toHaveLength(3);
    expect(wb.SheetNames).toEqual(['Resumen', 'Signos vitales', 'Seguimientos ePRO']);
    expect(wb.Sheets['Sintomas']).toBeUndefined();
  });

  it('serializa a bytes válidos legibles por SheetJS sin corromper la estructura', () => {
    const data = createMockReportData();
    const bytes = generateReportXlsxBytes(data);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(4000);

    const reReadWb = XLSX.read(bytes, { type: 'array' });
    expect(reReadWb.SheetNames).toEqual(['Resumen', 'Signos vitales', 'Seguimientos ePRO']);
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
    const specialText = '=SUM(1,2) Cansancio intenso @oncologia +prueba';
    const cell = makeTextCell(specialText);

    expect(cell.t).toBe('s');
    expect(cell.v).toBe(specialText);
    expect(String(cell.v ?? '').startsWith("'")).toBe(false);
    expect((cell as unknown as Record<string, unknown>).f).toBeUndefined();
  });

  it('mantiene identificación del paciente en Resumen y paridad de métricas', () => {
    const data = createMockReportData();

    // 1. Verificar HTML generado para PDF
    const html = buildReportHtml(data);
    expect(html).toContain(data.profile!.nombre);
    expect(html).toContain(data.profile!.rut);
    expect(html).toContain(data.treatment!.nombre);
    expect(html).not.toContain(data.linkingCode.displayText);
    expect(html).not.toContain(data.linkingCode.code!);
    expect(html).toContain('36,6 °C');
    expect(html).toContain('72 lpm');

    // 2. Verificar XLSX generado y re-leído
    const bytes = generateReportXlsxBytes(data);
    const reReadWb = XLSX.read(bytes, { type: 'array' });

    const summarySheet = reReadWb.Sheets['Resumen'];
    const summaryText = JSON.stringify(summarySheet);
    expect(summaryText).toContain(data.profile!.nombre);
    expect(summaryText).toContain(data.profile!.rut);
    expect(summaryText).not.toContain(data.profile!.email);
    expect(summaryText).toContain(data.treatment!.nombre);
    expect(summaryText).not.toContain(data.linkingCode.displayText);
    expect(summaryText).toContain(data.timeZone);

    // Hoja Signos vitales
    const vitalsSheet = reReadWb.Sheets['Signos vitales'];
    const vitalsText = JSON.stringify(vitalsSheet);
    expect(vitalsText).toContain(String(data.vitals[0].presion_sistolica));
    expect(vitalsText).toContain(String(data.vitals[0].pulso));

    // Hoja Síntomas no se genera
    expect(reReadWb.Sheets['Sintomas']).toBeUndefined();
  });

  it('incorpora fecha local identificada con zona, privacidad y celdas vacías para mediciones ausentes', () => {
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
    });

    const bytes = generateReportXlsxBytes(dataWithMissing);
    const reReadWb = XLSX.read(bytes, { type: 'array' });

    // 1. Resumen: incluye nombre y RUT del paciente
    const summarySheet = reReadWb.Sheets['Resumen'];
    const summaryJson = JSON.stringify(summarySheet);
    expect(summaryJson).not.toContain(dataWithMissing.linkingCode.code!);
    expect(summaryJson).toContain(dataWithMissing.profile!.nombre);
    expect(summaryJson).toContain(dataWithMissing.profile!.rut!);
    expect(summaryJson).toContain('America/Santiago');

    // 2. Signos vitales: encabezados locales
    const vitalsSheet = reReadWb.Sheets['Signos vitales'];
    expect(vitalsSheet['A1'].v).toBe('Fecha y hora local (America/Santiago)');
    expect(vitalsSheet['B1'].v).toBe('Presión sistólica (mmHg)');

    // Fila 2: Fecha
    expect(vitalsSheet['A2'].v).toContain('2026');

    // Mediciones ausentes: las celdas B2 (sistólica), C2 (diastólica) y F2 (sat O2) NO deben tener texto '—'
    expect(vitalsSheet['B2']).toBeUndefined();
    expect(vitalsSheet['C2']).toBeUndefined();
    expect(vitalsSheet['F2']).toBeUndefined();

    // Mediciones presentes: D2 (pulso) y E2 (temperatura) son numéricas
    expect(vitalsSheet['D2'].t).toBe('n');
    expect(vitalsSheet['D2'].v).toBe(78);
    expect(vitalsSheet['E2'].t).toBe('n');
    expect(vitalsSheet['E2'].v).toBe(36.5);
  });

  it('omite el código de vinculación incluso si su estado es usado, expirado o no disponible', () => {
    const statuses = ['cached_used', 'cached_expired', 'unavailable'] as const;

    for (const status of statuses) {
      const data = createMockReportData({
        linkingCode: {
          status,
          displayText: `Código de vinculación ${status}`,
          code: `SECRET-CODE-${status}`,
          expiresAt: null,
          obtainedAt: null,
        },
      });

      const bytes = generateReportXlsxBytes(data);
      const reReadWb = XLSX.read(bytes, { type: 'array' });

      for (const sheetName of reReadWb.SheetNames) {
        const sheet = reReadWb.Sheets[sheetName];
        const text = JSON.stringify(sheet);
        expect(text).not.toContain(`SECRET-CODE-${status}`);
      }
    }
  });

  it('reloj congelado: alterar el reloj del sistema tras capturar la instantánea no modifica la fecha de emisión en PDF ni en XLSX', () => {
    const fixedIso = '2026-10-04T12:30:00.000Z';
    const data = createMockReportData({
      generatedAt: fixedIso,
      periodEnd: fixedIso,
    });

    const realDateNow = Date.now;
    try {
      Date.now = () => Date.parse('2032-01-01T00:00:00.000Z');

      const html = buildReportHtml(data);
      expect(html).toContain('04-10-2026');
      expect(html).not.toContain('2032');

      const bytes = generateReportXlsxBytes(data);
      const reReadWb = XLSX.read(bytes, { type: 'array' });
      const summarySheet = reReadWb.Sheets['Resumen'];
      const summaryText = JSON.stringify(summarySheet);
      expect(summaryText).toContain('04-10-2026');
      expect(summaryText).not.toContain('2032');
    } finally {
      Date.now = realDateNow;
    }
  });

  it('maneja listas vacías de signos vitales con fila descriptiva', () => {
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
        avgPain: null,
      },
    });

    const bytes = generateReportXlsxBytes(emptyData);
    const reReadWb = XLSX.read(bytes, { type: 'array' });

    const vitalsSheet = JSON.stringify(reReadWb.Sheets['Signos vitales']);
    expect(vitalsSheet).toContain('No hay mediciones registradas en el período evaluado.');
    expect(reReadWb.Sheets['Sintomas']).toBeUndefined();
  });

  it('persiste el archivo .xlsx generado a través de generateAndPersistReportXlsx', async () => {
    const data = createMockReportData({ periodDays: 7 });
    const result = await generateAndPersistReportXlsx(data);

    expect(result.persistentUri).toBeDefined();
    expect(result.filename.startsWith('reporte_7d_')).toBe(true);
    expect(result.filename.endsWith('.xlsx')).toBe(true);

    // Limpieza
    await deletePatientReport(patientId, result.filename);
  });

  it('persiste, descifra y relee correctamente archivos .xlsx (7, 30 y 90 días) cuando el cifrado nativo agrega cabecera y etiqueta AES-GCM (+35 bytes)', async () => {
    const magicHeader = new TextEncoder().encode('QCAES1\n'); // 7 bytes
    const nonceAndTagOverhead = new Uint8Array(28).fill(0xaa); // 12 nonce + 16 tag = 28 bytes
    const releaseFramingCipher = activateFileCipher({
      owns: () => true,
      protect: async (_path, plain) => {
        const out = new Uint8Array(
          magicHeader.byteLength + nonceAndTagOverhead.byteLength + plain.byteLength,
        );
        out.set(magicHeader, 0);
        out.set(nonceAndTagOverhead, magicHeader.byteLength);
        out.set(plain, 35);
        return out;
      },
      unprotect: async (_path, encrypted) => {
        if (encrypted.byteLength < 35) {
          throw new Error('Ciphertext truncado');
        }
        return encrypted.subarray(35);
      },
    });

    try {
      for (const periodDays of [7, 30, 90] as const) {
        const data = createMockReportData({
          periodDays,
          vitals: [
            {
              id: 'v-zero-' + String(periodDays),
              paciente_id: patientId,
              fecha_registro: '2026-10-12T08:00:00.000Z',
              presion_sistolica: 0, // Valor cero explícito que no debe perderse
              presion_diastolica: null, // Celda vacía que debe preservar su columna
              pulso: 72,
              temperatura: 36.4,
              saturacion_o2: 99,
              fecha_subida: null,
            },
          ],
        });

        const result = await generateAndPersistReportXlsx(data);
        expect(result.filename.startsWith('reporte_' + String(periodDays) + 'd_')).toBe(true);
        expect(result.filename.endsWith('.xlsx')).toBe(true);

        const resolved = resolvePatientReportFile(patientId, {
          filename: result.filename,
          uri: result.persistentUri,
        });
        const encryptedOnDisk = await resolved.file.bytes();
        const plainExpected = generateReportXlsxBytes(data);
        expect(encryptedOnDisk.byteLength).toBe(plainExpected.byteLength + 35);

        const decryptedBytes = await readClinicalFile(resolved.canonicalUri, encryptedOnDisk);
        const workbook = XLSX.read(decryptedBytes, { type: 'array' });
        expect(workbook.SheetNames).toEqual(['Resumen', 'Signos vitales', 'Seguimientos ePRO']);

        const vitalsRows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(
          workbook.Sheets['Signos vitales'],
          { header: 1, defval: null },
        );
        expect(vitalsRows[1]?.[1]).toBe(0); // Sistólica = 0 conservada
        expect(vitalsRows[1]?.[2]).toBeNull(); // Diastólica vacía conservada como null en su columna
        expect(vitalsRows[1]?.[3]).toBe(72); // Pulso en su índice exacto

        await deletePatientReport(patientId, result.filename);
      }
    } finally {
      releaseFramingCipher();
    }
  });
});

beforeEach(() => {
  const release = activateFileCipher({
    owns: () => true,
    protect: async (_path, bytes) => bytes,
    unprotect: async (_path, bytes) => bytes,
  });
  return release;
});

describe('exportador Excel: datos ausentes y capturas ePRO sin respuestas', () => {
  const textos = (wb: XLSX.WorkBook, hoja: string) =>
    XLSX.utils.sheet_to_json<string[]>(wb.Sheets[hoja]!, { header: 1 }).flat().map(String);

  it('sin perfil, tratamiento, dolor ni ePRO usa los textos de respaldo', () => {
    const wb = buildReportWorkbook(
      createMockReportData({
        profile: null,
        treatment: null,
        epro: undefined,
        summary: { ...createMockReportData().summary, avgPain: undefined },
      } as unknown as Partial<ReportData>),
    );
    const resumen = textos(wb, 'Resumen');
    expect(resumen).toContain('Paciente en seguimiento');
    expect(resumen).toContain('No informado');
    expect(resumen).toContain('En seguimiento oncológico');
    expect(textos(wb, 'Seguimientos ePRO')).toContain(
      'No hay seguimientos ePRO en el período. Los borradores no se incluyen.',
    );
  });

  it('una captura sin respuestas se informa con una fila explícita', () => {
    const base = createMockReportData();
    const wb = buildReportWorkbook(
      createMockReportData({ epro: [{ ...base.epro![0]!, answers: [] }] }),
    );
    expect(textos(wb, 'Seguimientos ePRO')).toContain('Sin respuestas disponibles');
  });
});
