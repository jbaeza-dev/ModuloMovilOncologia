import type {
  PatientProfileRecord,
  SymptomRecord,
  TreatmentRecord,
  VitalRecord,
} from '../repository';

export type ReportFormat = 'pdf' | 'xlsx';

export type LinkingCodeStatus =
  | 'active_link'
  | 'cached_pending'
  | 'cached_expired'
  | 'cached_used'
  | 'unavailable';

export interface ReportLinkingCodeInfo {
  readonly status: LinkingCodeStatus;
  readonly displayText: string;
  readonly code: string | null;
  readonly expiresAt: string | null;
  readonly obtainedAt: string | null;
}

export interface ReportSummary {
  readonly vitalsCount: number;
  readonly symptomsCount: number;
  readonly avgTemperature: number | null;
  readonly avgPulse: number | null;
  readonly avgSystolic: number | null;
  readonly avgDiastolic: number | null;
  readonly avgOxygenSaturation: number | null;
  readonly minTemperature: number | null;
  readonly maxTemperature: number | null;
  readonly minPulse: number | null;
  readonly maxPulse: number | null;
}

export interface ReportData {
  readonly pacienteId: string;
  readonly periodDays: 7 | 30 | 90 | 365;
  readonly generatedAt: string; // ISO 8601 UTC canónico
  readonly timeZone: string; // Zona horaria de referencia
  readonly periodStart: string; // ISO 8601 UTC canónico [ahora - N días]
  readonly periodEnd: string; // ISO 8601 UTC canónico [ahora]
  readonly profile: Readonly<PatientProfileRecord> | null;
  readonly treatment: Readonly<TreatmentRecord> | null;
  readonly linkingCode: Readonly<ReportLinkingCodeInfo>;
  readonly summary: Readonly<ReportSummary>;
  readonly vitals: readonly Readonly<VitalRecord>[];
  readonly symptoms: readonly Readonly<SymptomRecord>[];
  readonly epro?: readonly ReportEproCapture[];
  readonly syncStatuses?: Readonly<Record<string, string>>;
}

export interface ReportEproCapture {
  readonly id: string;
  readonly formId: string;
  readonly version: string;
  readonly title: string;
  readonly capturedAt: string;
  readonly status: string;
  readonly source: 'snapshot' | 'legacy';
  readonly answers: readonly {
    readonly code: string;
    readonly question: string;
    readonly value: string;
  }[];
}
