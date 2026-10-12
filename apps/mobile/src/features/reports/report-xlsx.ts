import * as XLSX from 'xlsx';

import {
  persistReportXlsx,
  type BinaryReportStorageAdapter,
} from '../../data/local/files/report-storage';
import type { ReportData } from '../../data/local/reports/report-types';

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
 * Construye el libro de trabajo con tres hojas estructuradas:
 * 1. Resumen: Información general, perfil, vinculación en caché, tratamiento y métricas agregadas.
 * 2. Signos vitales: Detalle cronológico de todas las mediciones de signos vitales con ID y fecha local.
 * 3. Sintomas: Detalle cronológico de los síntomas con ID y fecha local.
 */
export function buildReportWorkbook(data: ReportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  let displayLinkingCode = 'No disponible';
  if (data.linkingCode.code) {
    if (data.linkingCode.status === 'cached_used') {
      displayLinkingCode = `${data.linkingCode.code} (código histórico fuera de uso - utilizado)`;
    } else if (data.linkingCode.status === 'cached_expired') {
      displayLinkingCode = `${data.linkingCode.code} (código histórico fuera de uso - expirado)`;
    } else if (
      data.linkingCode.status === 'active_link' ||
      data.linkingCode.status === 'cached_pending'
    ) {
      displayLinkingCode = data.linkingCode.code;
    } else {
      displayLinkingCode = 'No disponible';
    }
  }

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
    [],
    [makeTextCell('PERFIL DEL PACIENTE')],
    [makeTextCell('Nombre'), makeTextCell(data.profile?.nombre ?? 'Sin registro')],
    [makeTextCell('RUT'), makeTextCell(data.profile?.rut ?? 'Sin registro')],
    [makeTextCell('Correo electrónico'), makeTextCell(data.profile?.email ?? 'Sin registro')],
    [],
    [makeTextCell('VINCULACIÓN CLÍNICA (INFORMACIÓN EN CACHÉ LOCAL)')],
    [makeTextCell('Estado de vinculación'), makeTextCell(data.linkingCode.displayText)],
    [makeTextCell('Código de vinculación'), makeTextCell(displayLinkingCode)],
    [
      makeTextCell('Fecha de obtención en caché (UTC)'),
      makeTextCell(data.linkingCode.obtainedAt ?? 'No disponible'),
    ],
    [
      makeTextCell(`Fecha de obtención local (${data.timeZone})`),
      makeTextCell(
        data.linkingCode.obtainedAt
          ? formatLocalDate(data.linkingCode.obtainedAt, data.timeZone)
          : 'No disponible',
      ),
    ],
    [
      makeTextCell('Fecha de expiración (UTC)'),
      makeTextCell(data.linkingCode.expiresAt ?? 'No disponible'),
    ],
    [
      makeTextCell('Nota de vigencia'),
      makeTextCell('Información en caché local — no acredita validación remota en tiempo real'),
    ],
    [],
    [makeTextCell('TRATAMIENTO ACTIVO')],
    [
      makeTextCell('Nombre del tratamiento'),
      makeTextCell(data.treatment?.nombre ?? 'Sin tratamiento activo registrado'),
    ],
    [makeTextCell('Tipo'), makeTextCell(data.treatment?.tipo ?? '—')],
    [makeTextCell('Fecha de inicio'), makeTextCell(data.treatment?.fecha_inicio ?? '—')],
    [],
    [makeTextCell('MÉTRICAS AGREGADAS EN EL PERÍODO')],
    [makeTextCell('Total mediciones de signos vitales'), makeNumberCell(data.summary.vitalsCount)],
    [makeTextCell('Temperatura promedio (°C)'), makeNumberCell(data.summary.avgTemperature)],
    [makeTextCell('Pulso promedio (ppm)'), makeNumberCell(data.summary.avgPulse)],
    [makeTextCell('Presión sistólica promedio (mmHg)'), makeNumberCell(data.summary.avgSystolic)],
    [makeTextCell('Presión diastólica promedio (mmHg)'), makeNumberCell(data.summary.avgDiastolic)],
    [makeTextCell('Saturación O₂ promedio (%)'), makeNumberCell(data.summary.avgOxygenSaturation)],
    [makeTextCell('Total reportes de síntomas'), makeNumberCell(data.summary.symptomsCount)],
    [],
    [makeTextCell('AVISO')],
    [
      makeTextCell(
        'Este documento contiene mediciones sintéticas guardadas localmente en el dispositivo para evaluación del módulo móvil. No constituye diagnóstico médico ni sustituye indicaciones del equipo tratante.',
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
      ]);
    }
  }

  const wsVitals = createWorksheet(vitalsRows, [38, 26, 26, 25, 25, 16, 18, 18]);
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
