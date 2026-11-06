import * as XLSX from 'xlsx';

import {
  persistReportXlsx,
  type BinaryReportStorageAdapter,
} from '../../data/local/files/report-storage';
import type { ReportData } from '../../data/local/reports/report-types';
import { clinicalStatusLabel } from '../../data/sync/visible-status';

/**
 * Crea una celda de texto literal garantizando que el tipo sea 's' (string)
 * y que no existan propiedades de fórmula ('f') ni enlaces ('l').
 * Preserva caracteres iniciales como '=', '+', '-', '@' sin anteponer comillas simples.
 */
export function makeTextCell(value: string | null | undefined): XLSX.CellObject {
  const str = value === null || value === undefined ? '' : String(value);
  return { t: 's', v: str };
}

/**
 * Crea una celda numérica con valor tipado 'n', o devuelve null (celda vacía) si es nulo o indefinido.
 */
export function makeNumberCell(value: number | null | undefined): XLSX.CellObject | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return { t: 'n', v: value };
}

export function formatLocalDate(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function createWorksheet(
  rows: Array<Array<XLSX.CellObject | null | undefined>>,
  colWidths?: number[],
): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxR = 0;
  let maxC = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell) {
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = cell;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
    }
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  if (colWidths) {
    ws['!cols'] = colWidths.map((wch) => ({ wch }));
  }
  return ws;
}

/**
 * Construye el libro de trabajo con cuatro hojas estructuradas:
 * 1. Resumen: Identificación del paciente, tratamiento y métricas clínicas relevantes.
 * 2. Signos vitales: Detalle cronológico de todas las mediciones de signos vitales con fecha local.
 * 3. Seguimientos ePRO: Respuestas confirmadas con su fecha local, formulario y estado.
 */
export function buildReportWorkbook(data: ReportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // 1. Hoja "Resumen"
  const summaryRows: Array<Array<XLSX.CellObject | null | undefined>> = [
    [makeTextCell('QuimioCare — Reporte de Seguimiento Oncológico')],
    [],
    [makeTextCell('IDENTIFICACIÓN DEL PACIENTE')],
    [
      makeTextCell('Nombre del paciente'),
      makeTextCell(data.profile?.nombre || 'Paciente en seguimiento'),
    ],
    [makeTextCell('RUT'), makeTextCell(data.profile?.rut || 'Sin registrar')],
    [
      makeTextCell('Tratamiento'),
      makeTextCell(data.treatment?.nombre ?? data.treatment?.tipo ?? 'En seguimiento oncológico'),
    ],
    [],
    [makeTextCell('INFORMACIÓN DEL REPORTE')],
    [makeTextCell('Período evaluado'), makeTextCell(`Últimos ${data.periodDays} días`)],
    [
      makeTextCell(`Rango de fechas (${data.timeZone})`),
      makeTextCell(
        `${formatLocalDate(data.periodStart, data.timeZone)} al ${formatLocalDate(data.periodEnd, data.timeZone)}`,
      ),
    ],
    [
      makeTextCell(`Fecha de emisión (${data.timeZone})`),
      makeTextCell(formatLocalDate(data.generatedAt, data.timeZone)),
    ],
    [],
    [makeTextCell('RESUMEN CLÍNICO DEL PERÍODO')],
    [makeTextCell('Total mediciones de signos vitales'), makeNumberCell(data.summary.vitalsCount)],
    [makeTextCell('Temperatura promedio (°C)'), makeNumberCell(data.summary.avgTemperature)],
    [makeTextCell('Pulso promedio (ppm)'), makeNumberCell(data.summary.avgPulse)],
    [makeTextCell('Presión sistólica promedio (mmHg)'), makeNumberCell(data.summary.avgSystolic)],
    [makeTextCell('Presión diastólica promedio (mmHg)'), makeNumberCell(data.summary.avgDiastolic)],
    [makeTextCell('Saturación O₂ promedio (%)'), makeNumberCell(data.summary.avgOxygenSaturation)],
    [makeTextCell('Dolor ENA promedio (0–10)'), makeNumberCell(data.summary.avgPain ?? null)],
    [
      makeTextCell('Seguimientos ePRO confirmados localmente'),
      makeNumberCell(data.epro?.length ?? 0),
    ],
    [],
    [makeTextCell('AVISO CLÍNICO')],
    [
      makeTextCell(
        'Este reporte contiene registros clínicos informados por el paciente para apoyo al equipo tratante. La recepción del servidor no implica revisión clínica inmediata. No sustituye la consulta médica presencial ni la atención en urgencias.',
      ),
    ],
  ];

  const wsSummary = createWorksheet(summaryRows, [42, 55]);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  // 2. Hoja "Signos vitales"
  const vitalsHeaders: Array<XLSX.CellObject> = [
    makeTextCell(`Fecha y hora local (${data.timeZone})`),
    makeTextCell('Presión sistólica (mmHg)'),
    makeTextCell('Presión diastólica (mmHg)'),
    makeTextCell('Pulso (ppm)'),
    makeTextCell('Temperatura (°C)'),
    makeTextCell('Saturación O₂ (%)'),
    makeTextCell('Dolor ENA (0–10)'),
    makeTextCell('Estado de envío'),
  ];

  const vitalsRows: Array<Array<XLSX.CellObject | null | undefined>> = [vitalsHeaders];
  if (data.vitals.length === 0) {
    vitalsRows.push([
      makeTextCell('No hay mediciones registradas en el período evaluado.'),
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  } else {
    for (const v of data.vitals) {
      vitalsRows.push([
        makeTextCell(formatLocalDate(v.fecha_registro, data.timeZone)),
        makeNumberCell(v.presion_sistolica),
        makeNumberCell(v.presion_diastolica),
        makeNumberCell(v.pulso),
        makeNumberCell(v.temperatura),
        makeNumberCell(v.saturacion_o2),
        makeNumberCell(v.dolor_ena ?? null),
        makeTextCell(
          clinicalStatusLabel(data.syncStatuses?.[v.id] ?? (v.fecha_subida ? 'enviado' : null)),
        ),
      ]);
    }
  }

  const wsVitals = createWorksheet(vitalsRows, [26, 25, 25, 16, 18, 18, 20, 24]);
  XLSX.utils.book_append_sheet(wb, wsVitals, 'Signos vitales');

  // 3. Hoja "Seguimientos ePRO"
  const eproRows: Array<Array<XLSX.CellObject | null>> = [
    [
      `Fecha local (${data.timeZone})`,
      'Formulario',
      'Estado de envío',
      'Pregunta',
      'Respuesta',
    ].map(makeTextCell),
  ];
  for (const capture of data.epro ?? []) {
    const localCapturedAt = formatLocalDate(capture.capturedAt, data.timeZone);
    const statusLabel = clinicalStatusLabel(capture.status);
    for (const answer of capture.answers.length
      ? capture.answers
      : [{ code: '', question: '', value: 'Sin respuestas disponibles' }])
      eproRows.push(
        [localCapturedAt, capture.title, statusLabel, answer.question, answer.value].map(
          makeTextCell,
        ),
      );
  }
  if (!data.epro?.length)
    eproRows.push([
      makeTextCell('No hay seguimientos ePRO en el período. Los borradores no se incluyen.'),
    ]);
  XLSX.utils.book_append_sheet(
    wb,
    createWorksheet(eproRows, [26, 35, 24, 60, 60]),
    'Seguimientos ePRO',
  );

  return wb;
}

/**
 * Serializa los datos del reporte a bytes binarios en formato .xlsx (Uint8Array).
 */
export function generateReportXlsxBytes(data: ReportData): Uint8Array {
  const wb = buildReportWorkbook(data);
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(buffer);
}

/**
 * Genera el archivo Excel .xlsx del reporte y lo persiste de forma segura
 * en el almacenamiento aislado del paciente activo.
 */
export async function generateAndPersistReportXlsx(
  data: ReportData,
  adapter?: BinaryReportStorageAdapter,
): Promise<{ persistentUri: string; filename: string }> {
  const bytes = generateReportXlsxBytes(data);
  const patientName = data.profile?.nombre || undefined;
  return await persistReportXlsx(data.pacienteId, bytes, data.periodDays, adapter, patientName);
}
