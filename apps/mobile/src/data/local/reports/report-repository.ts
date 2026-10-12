import type { SqlConnection } from '../core/sql';
import type {
  PatientProfileRecord,
  SymptomRecord,
  TreatmentRecord,
  VitalRecord,
} from '../repository';
import type { ReportData, ReportLinkingCodeInfo, ReportSummary } from './report-types';

export function createReportRepository(
  database: SqlConnection,
  patientId: string,
  nowProvider: () => string = () => new Date().toISOString(),
) {
  return {
    async getReportData(periodDays: 7 | 30 | 90, customNow?: string): Promise<ReportData> {
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
  };
}
