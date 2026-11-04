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
 * 1. Resumen: Identificador mínimo, tratamiento y métricas; sin perfil ni código de vinculación.
 * 2. Signos vitales: Detalle cronológico de todas las mediciones de signos vitales con ID y fecha local.
 * 3. Sintomas: Historial libre antiguo.
 * 4. Seguimientos ePRO: Respuestas confirmadas con su edición y estado.
 */
export function buildReportWorkbook(data: ReportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // 1. Hoja "Resumen"
  const summaryRows: Array<Array<XLSX.CellObject | null | undefined>> = [
    [makeTextCell('QuimioCare — Reporte de Seguimiento Oncológico')],
    [],
    [makeTextCell('INFORMACIÓN DEL REPORTE')],
    [makeTextCell('Período evaluado'), makeTextCell(`Últimos ${data.periodDays} días`)],
    [makeTextCell('Inicio del período (UTC)'), makeTextCell(data.periodStart)],
    [
      makeTextCell(`Inicio del período local (${data.timeZone})`),
      makeTextCell(formatLocalDate(data.periodStart, data.timeZone)),
    ],
    [makeTextCell('Fin del período (UTC)'), makeTextCell(data.periodEnd)],
    [
      makeTextCell(`Fin del período local (${data.timeZone})`),
      makeTextCell(formatLocalDate(data.periodEnd, data.timeZone)),
    ],
    [makeTextCell('Fecha de emisión (UTC)'), makeTextCell(data.generatedAt)],
    [
      makeTextCell(`Fecha de emisión local (${data.timeZone})`),
      makeTextCell(formatLocalDate(data.generatedAt, data.timeZone)),
    ],
    [makeTextCell('Zona horaria de referencia'), makeTextCell(data.timeZone)],
    [makeTextCell('ID del paciente'), makeTextCell(data.pacienteId)],
    [makeTextCell('Tratamiento'), makeTextCell(data.treatment?.nombre ?? data.treatment?.tipo)],
    [],
    [makeTextCell('MÉTRICAS AGREGADAS EN EL PERÍODO')],
    [makeTextCell('Total mediciones de signos vitales'), makeNumberCell(data.summary.vitalsCount)],
    [makeTextCell('Temperatura promedio (°C)'), makeNumberCell(data.summary.avgTemperature)],
    [makeTextCell('Pulso promedio (ppm)'), makeNumberCell(data.summary.avgPulse)],
    [makeTextCell('Presión sistólica promedio (mmHg)'), makeNumberCell(data.summary.avgSystolic)],
    [makeTextCell('Presión diastólica promedio (mmHg)'), makeNumberCell(data.summary.avgDiastolic)],
    [makeTextCell('Saturación O₂ promedio (%)'), makeNumberCell(data.summary.avgOxygenSaturation)],
    [makeTextCell('Total reportes de síntomas'), makeNumberCell(data.summary.symptomsCount)],
    [
      makeTextCell('Seguimientos ePRO confirmados localmente'),
      makeNumberCell(data.epro?.length ?? 0),
    ],
    [],
    [makeTextCell('AVISO')],
    [
      makeTextCell(
        'Registros locales con identificador mínimo; se omiten los campos de nombre, RUT, correo y código de vinculación. Los textos libres conservan lo que escribiste: revisa antes de compartir. Recepción del servidor no implica revisión clínica. No sustituye indicaciones del equipo tratante.',
      ),
    ],
  ];

  const wsSummary = createWorksheet(summaryRows, [42, 55]);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  // 2. Hoja "Signos vitales"
  const vitalsHeaders: Array<XLSX.CellObject> = [
    makeTextCell('ID del registro'),
    makeTextCell('Fecha y hora (UTC)'),
    makeTextCell(`Fecha local (${data.timeZone})`),
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
      makeTextCell('—'),
      makeTextCell('No hay mediciones registradas en el período evaluado.'),
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
        makeTextCell(v.id),
        makeTextCell(v.fecha_registro),
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

  const wsVitals = createWorksheet(vitalsRows, [38, 26, 26, 25, 25, 16, 18, 18, 20, 32]);
  XLSX.utils.book_append_sheet(wb, wsVitals, 'Signos vitales');

  // 3. Hoja "Sintomas"
  const symptomsHeaders: Array<XLSX.CellObject> = [
    makeTextCell('ID del registro'),
    makeTextCell('Fecha y hora (UTC)'),
    makeTextCell(`Fecha local (${data.timeZone})`),
    makeTextCell('Descripción del síntoma'),
  ];

  const symptomsRows: Array<Array<XLSX.CellObject | null | undefined>> = [symptomsHeaders];
  if (data.symptoms.length === 0) {
    symptomsRows.push([
      makeTextCell('—'),
      makeTextCell('No hay síntomas registrados en el período evaluado.'),
      null,
      null,
    ]);
  } else {
    for (const s of data.symptoms) {
      symptomsRows.push([
        makeTextCell(s.id),
        makeTextCell(s.fecha_registro),
        makeTextCell(formatLocalDate(s.fecha_registro, data.timeZone)),
        makeTextCell(s.descripcion ?? ''),
      ]);
    }
  }

  const wsSymptoms = createWorksheet(symptomsRows, [38, 26, 26, 70]);
  XLSX.utils.book_append_sheet(wb, wsSymptoms, 'Sintomas');

  const eproRows: Array<Array<XLSX.CellObject | null>> = [
    [
      'ID de captura',
      'ID formulario',
      'Edición',
      'Título',
      'Fecha UTC',
      `Fecha local (${data.timeZone})`,
      'Estado de envío',
      'Fuente histórica',
      'Código de pregunta',
      'Pregunta',
      'Respuesta',
    ].map(makeTextCell),
  ];
  for (const capture of data.epro ?? []) {
    // La fecha y el estado pertenecen a la captura, no cambian por cada respuesta.
    const localCapturedAt = formatLocalDate(capture.capturedAt, data.timeZone);
    const statusLabel = clinicalStatusLabel(capture.status);
    for (const answer of capture.answers.length
      ? capture.answers
      : [{ code: '', question: '', value: 'Sin respuestas disponibles' }])
      eproRows.push(
        [
          capture.id,
          capture.formId,
          capture.version,
          capture.title,
          capture.capturedAt,
          localCapturedAt,
          statusLabel,
          capture.source,
          answer.code,
          answer.question,
          answer.value,
        ].map(makeTextCell),
      );
  }
  if (!data.epro?.length)
    eproRows.push([
      makeTextCell('No hay seguimientos ePRO en el período. Los borradores no se incluyen.'),
    ]);
  XLSX.utils.book_append_sheet(
    wb,
    createWorksheet(eproRows, [38, 38, 16, 45, 26, 26, 32, 16, 22, 65, 65]),
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
  return await persistReportXlsx(data.pacienteId, bytes, data.periodDays, adapter);
}
