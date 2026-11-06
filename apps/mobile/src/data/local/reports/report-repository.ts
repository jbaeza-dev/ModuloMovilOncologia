import type { FormQuestion } from '@quimiocare/contracts/forms';
import type { SqlConnection } from '../core/sql';
import type {
  PatientProfileRecord,
  SymptomRecord,
  TreatmentRecord,
  VitalRecord,
} from '../repository';
import type { ReportData, ReportLinkingCodeInfo, ReportSummary } from './report-types';
import { reportEpro, type ReportEproRow } from './report-epro';

export function createReportRepository(
  database: SqlConnection,
  patientId: string,
  nowProvider: () => string = () => new Date().toISOString(),
) {
  return {
    async getReportData(periodDays: 7 | 30 | 90 | 365, customNow?: string): Promise<ReportData> {
      if (![7, 30, 90, 365].includes(periodDays))
        throw new Error('Período de reporte no admitido.');
      // 1. VALIDACIÓN Y NORMALIZACIÓN ESTRICTA DE NOW A ISO UTC CANÓNICO
      const parsedNow = new Date(customNow ?? nowProvider());
      if (!Number.isFinite(parsedNow.getTime())) {
        throw new Error('Instante de generación inválido.');
      }
      const now = parsedNow.toISOString();
      const periodStartDate = new Date(parsedNow.getTime() - periodDays * 86400 * 1000);
      const periodStart = periodStartDate.toISOString();

      let rawProfile: PatientProfileRecord | null = null;
      let rawTreatment: TreatmentRecord | null = null;
      let rawVitals: VitalRecord[] = [];
      let rawSymptoms: SymptomRecord[] = [];
      let epro: ReturnType<typeof reportEpro>[] = [];
      const syncStatuses: Record<string, string> = {};
      let linkingInfo: ReportLinkingCodeInfo = {
        status: 'unavailable',
        displayText: 'Código de vinculación no disponible',
        code: null,
        expiresAt: null,
        obtainedAt: null,
      };

      // 2. LECTURA EXCLUSIVA SOBRE TX
      await database.transaction(async (tx) => {
        rawProfile = await tx.first<PatientProfileRecord>(
          'SELECT * FROM paciente_cache WHERE paciente_id = ?',
          [patientId],
        );

        rawTreatment = await tx.first<TreatmentRecord>(
          `SELECT * FROM tratamiento_cache
           WHERE paciente_id = ? AND estado = 'activo'
           ORDER BY obtenido_en DESC, id DESC LIMIT 1`,
          [patientId],
        );

        // Desempate determinista para vínculo activo con código reportable
        const activeLink = await tx.first<{
          codigo_origen: string;
          fecha_vinculacion: string;
          obtenido_en: string;
        }>(
          `SELECT codigo_origen, fecha_vinculacion, obtenido_en FROM paciente_clinico_cache
           WHERE paciente_id = ? AND estado_conocido = 'activo'
             AND codigo_origen IS NOT NULL AND TRIM(codigo_origen) != ''
           ORDER BY fecha_vinculacion DESC, id DESC LIMIT 1`,
          [patientId],
        );

        if (activeLink) {
          linkingInfo = {
            status: 'active_link',
            displayText: `Vínculo activo según información en caché: ${activeLink.codigo_origen}`,
            code: activeLink.codigo_origen,
            expiresAt: null,
            obtainedAt: activeLink.obtenido_en,
          };
        } else {
          // Consultar código temporal en caché
          const cachedCode = await tx.first<{
            codigo: string;
            expira_en: string;
            estado_conocido: string;
            obtenido_en: string;
          }>(
            `SELECT codigo, expira_en, estado_conocido, obtenido_en
             FROM codigo_vinculacion_cache
             WHERE paciente_id = ?
             ORDER BY obtenido_en DESC LIMIT 1`,
            [patientId],
          );

          if (cachedCode) {
            const parsedExpires = Date.parse(cachedCode.expira_en);
            const isInvalidExpires = Number.isNaN(parsedExpires);
            const isExpired = !isInvalidExpires && parsedExpires <= parsedNow.getTime();

            if (isInvalidExpires) {
              linkingInfo = {
                status: 'unavailable',
                displayText:
                  'Código de vinculación no disponible (fecha de expiración inválida en caché)',
                code: null,
                expiresAt: null,
                obtainedAt: cachedCode.obtenido_en,
              };
            } else if (cachedCode.estado_conocido === 'usado') {
              linkingInfo = {
                status: 'cached_used',
                displayText:
                  'Código de vinculación no disponible (código temporal ya utilizado según información en caché)',
                code: cachedCode.codigo,
                expiresAt: cachedCode.expira_en,
                obtainedAt: cachedCode.obtenido_en,
              };
            } else if (cachedCode.estado_conocido === 'expirado' || isExpired) {
              linkingInfo = {
                status: 'cached_expired',
                displayText:
                  'Código de vinculación no disponible (código temporal expirado según información en caché)',
                code: cachedCode.codigo,
                expiresAt: cachedCode.expira_en,
                obtainedAt: cachedCode.obtenido_en,
              };
            } else if (cachedCode.estado_conocido === 'pendiente') {
              linkingInfo = {
                status: 'cached_pending',
                displayText: `Código temporal en caché: ${cachedCode.codigo} (Estado: Pendiente, Vence: ${cachedCode.expira_en})`,
                code: cachedCode.codigo,
                expiresAt: cachedCode.expira_en,
                obtainedAt: cachedCode.obtenido_en,
              };
            } else {
              linkingInfo = {
                status: 'unavailable',
                displayText: 'Código de vinculación no disponible',
                code: null,
                expiresAt: null,
                obtainedAt: cachedCode.obtenido_en,
              };
            }
          }
        }

        // Signos vitales del período exacto [periodStart, now], cronológico ascendente
        rawVitals = await tx.all<VitalRecord>(
          `SELECT * FROM signos_vitales
           WHERE paciente_id = ? AND fecha_registro >= ? AND fecha_registro <= ?
           ORDER BY fecha_registro ASC, id ASC`,
          [patientId, periodStart, now],
        );

        // Síntomas del período exacto [periodStart, now], cronológico ascendente
        rawSymptoms = await tx.all<SymptomRecord>(
          `SELECT * FROM sintomas
           WHERE paciente_id = ? AND fecha_registro >= ? AND fecha_registro <= ?
           ORDER BY fecha_registro ASC, id ASC`,
          [patientId, periodStart, now],
        );
        const commands = await tx.all<{ id: string; status: string }>(
          `SELECT c.id,c.status FROM qc_clinical_command c
           JOIN signos_vitales v ON v.id=c.id AND v.fecha_registro=c.captured_at
           WHERE v.paciente_id=? AND c.kind='signos' AND v.fecha_registro>=? AND v.fecha_registro<=?`,
          [patientId, periodStart, now],
        );
        for (const c of commands) syncStatuses[c.id] = c.status;
        const rows = await tx.all<ReportEproRow>(
          `SELECT r.id,r.formulario_id,r.version,r.respuestas_json,r.fecha_confirmacion,f.titulo,
           s.value_json AS snapshot_json,c.status,c.owner,c.environment
           FROM respuesta_formulario r
           LEFT JOIN formulario_cache f ON f.formulario_id=r.formulario_id AND f.version=r.version
           LEFT JOIN qc_storage_control s ON s.id='epro:capture:' || r.id
           LEFT JOIN qc_clinical_command c ON c.id=r.id AND c.kind='epro' AND c.captured_at=r.fecha_confirmacion
           WHERE r.paciente_id=? AND r.fecha_confirmacion>=? AND r.fecha_confirmacion<=?
           ORDER BY r.fecha_confirmacion ASC,r.id ASC`,
          [patientId, periodStart, now],
        );
        const questionsMap = new Map<string, FormQuestion[]>();
        for (const row of rows) {
          if (!row.snapshot_json) {
            const key = `${row.formulario_id}:${row.version}`;
            if (!questionsMap.has(key)) {
              const cached = await tx.all<{
                pregunta_id: string;
                texto: string;
                tipo: string;
                configuracion_json: string | null;
                orden: number;
              }>(
                `SELECT pregunta_id, texto, tipo, configuracion_json, orden
                 FROM pregunta_cache
                 WHERE formulario_id = ? AND version = ? AND retirado = 0
                 ORDER BY orden ASC`,
                [row.formulario_id, row.version],
              );
              questionsMap.set(
                key,
                cached.map((p) => {
                  let opciones: Array<{ codigo: string; etiqueta: string }> | undefined;
                  try {
                    if (p.configuracion_json) {
                      const cfg = JSON.parse(p.configuracion_json);
                      if (Array.isArray(cfg.opciones)) opciones = cfg.opciones;
                    }
                  } catch {
                    // Ignora error de parseo
                  }
                  return {
                    id: p.pregunta_id,
                    codigo: p.pregunta_id,
                    titulo: p.texto,
                    tipo: p.tipo as FormQuestion['tipo'],
                    orden: p.orden,
                    opciones,
                  };
                }),
              );
            }
          }
        }
        epro = rows.map((r) => reportEpro(r, questionsMap.get(`${r.formulario_id}:${r.version}`)));
      });

      // 3. CÁLCULO ESTADÍSTICO TRAS LIBERAR LA TRANSACCIÓN
      const summary = computeReportSummary(rawVitals, rawSymptoms.length);

      // Inmutabilidad profunda con Object.freeze en cada registro
      const frozenProfile = rawProfile ? Object.freeze(rawProfile) : null;
      const frozenTreatment = rawTreatment ? Object.freeze(rawTreatment) : null;

      const frozenVitals = Object.freeze(rawVitals.map((v) => Object.freeze(v)));
      const frozenSymptoms = Object.freeze(rawSymptoms.map((s) => Object.freeze(s)));

      return Object.freeze({
        pacienteId: patientId,
        periodDays,
        generatedAt: now,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        periodStart,
        periodEnd: now,
        profile: frozenProfile,
        treatment: frozenTreatment,
        linkingCode: Object.freeze({ ...linkingInfo }),
        summary: Object.freeze(summary),
        vitals: frozenVitals,
        symptoms: frozenSymptoms,
        epro: Object.freeze(epro),
        syncStatuses: Object.freeze(syncStatuses),
      });
    },

    symptomsForReport(sinceIso: string, untilIso?: string) {
      if (untilIso) {
        return database.all<SymptomRecord>(
          `SELECT * FROM sintomas
           WHERE paciente_id = ? AND fecha_registro >= ? AND fecha_registro <= ?
           ORDER BY fecha_registro ASC, id ASC`,
          [patientId, sinceIso, untilIso],
        );
      }
      return database.all<SymptomRecord>(
        `SELECT * FROM sintomas
         WHERE paciente_id = ? AND fecha_registro >= ?
         ORDER BY fecha_registro ASC, id ASC`,
        [patientId, sinceIso],
      );
    },

    vitalsForReport(sinceIso: string, untilIso?: string) {
      if (untilIso) {
        return database.all<VitalRecord>(
          `SELECT * FROM signos_vitales
           WHERE paciente_id = ? AND fecha_registro >= ? AND fecha_registro <= ?
           ORDER BY fecha_registro ASC, id ASC`,
          [patientId, sinceIso, untilIso],
        );
      }
      return database.all<VitalRecord>(
        `SELECT * FROM signos_vitales
         WHERE paciente_id = ? AND fecha_registro >= ?
         ORDER BY fecha_registro ASC, id ASC`,
        [patientId, sinceIso],
      );
    },
  };
}

function computeReportSummary(vitals: VitalRecord[], symptomsCount: number): ReportSummary {
  let tempSum = 0,
    tempCount = 0;
  let pulseSum = 0,
    pulseCount = 0;
  let sysSum = 0,
    sysCount = 0;
  let diaSum = 0,
    diaCount = 0;
  let satSum = 0,
    satCount = 0;
  let painSum = 0,
    painCount = 0;
  let minTemp: number | null = null,
    maxTemp: number | null = null;
  let minPulse: number | null = null,
    maxPulse: number | null = null;

  for (const v of vitals) {
    if (v.temperatura !== null) {
      tempSum += v.temperatura;
      tempCount++;
      minTemp = minTemp === null ? v.temperatura : Math.min(minTemp, v.temperatura);
      maxTemp = maxTemp === null ? v.temperatura : Math.max(maxTemp, v.temperatura);
    }
    if (v.pulso !== null) {
      pulseSum += v.pulso;
      pulseCount++;
      minPulse = minPulse === null ? v.pulso : Math.min(minPulse, v.pulso);
      maxPulse = maxPulse === null ? v.pulso : Math.max(maxPulse, v.pulso);
    }
    if (v.presion_sistolica !== null) {
      sysSum += v.presion_sistolica;
      sysCount++;
    }
    if (v.presion_diastolica !== null) {
      diaSum += v.presion_diastolica;
      diaCount++;
    }
    if (v.saturacion_o2 !== null) {
      satSum += v.saturacion_o2;
      satCount++;
    }
    if (v.dolor_ena !== null && v.dolor_ena !== undefined) {
      painSum += v.dolor_ena;
      painCount++;
    }
  }

  const round1 = (val: number) => Math.round(val * 10) / 10;
  const round0 = (val: number) => Math.round(val);

  return {
    vitalsCount: vitals.length,
    symptomsCount,
    avgTemperature: tempCount > 0 ? round1(tempSum / tempCount) : null,
    avgPulse: pulseCount > 0 ? round0(pulseSum / pulseCount) : null,
    avgSystolic: sysCount > 0 ? round0(sysSum / sysCount) : null,
    avgDiastolic: diaCount > 0 ? round0(diaSum / diaCount) : null,
    avgOxygenSaturation: satCount > 0 ? round1(satSum / satCount) : null,
    minTemperature: minTemp,
    maxTemperature: maxTemp,
    minPulse,
    maxPulse,
    avgPain: painCount > 0 ? round1(painSum / painCount) : null,
  };
}
