export type ReminderType = 'registro_vitales' | 'medicacion';

export type NotificationJobState =
  | 'pendiente'
  | 'programada'
  | 'cancelacion_pendiente'
  | 'cancelada'
  | 'finalizada_sin_observacion'
  | 'error';

export function generateUuid(): string {
  if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface NoticePreferencesRecord {
  paciente_id: string;
  habilitado: number; // 0 | 1
  actualizado_el: string;
}

export interface ReminderRuleRecord {
  id: string;
  paciente_id: string;
  tipo: ReminderType;
  medicamento_id: string | null;
  dias_semana: string; // JSON array string e.g. "[1,2,3,4,5,6,7]"
  horas_minutos: string; // JSON array string e.g. "[\"09:00\"]"
  zona_horaria: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  habilitado: number; // 0 | 1
  revision: number;
  eliminado_el: string | null;
  creado_el: string;
  actualizado_el: string;
}

export interface ReminderRule {
  id: string;
  pacienteId: string;
  tipo: ReminderType;
  medicamentoId: string | null;
  diasSemana: number[]; // 1=Lunes .. 7=Domingo
  horasMinutos: string[]; // "HH:mm"
  zonaHoraria: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  habilitado: boolean;
  revision: number;
  eliminadoEl: string | null;
  creadoEl: string;
  actualizadoEl: string;
}

export interface NotificationRecord {
  id: string;
  paciente_id: string;
  recordatorio_id: string;
  revision: number;
  tipo: ReminderType;
  fecha_prevista_utc: string;
  id_nativo: string | null;
  estado: NotificationJobState;
  payload_minimo: string;
  error: string | null;
  recibida_observada_en: string | null;
  abierta_en: string | null;
  creado_el: string;
  actualizado_el: string;
}

export interface NotificationItem {
  id: string;
  pacienteId: string;
  recordatorioId: string;
  revision: number;
  tipo: ReminderType;
  fechaPrevistaUtc: string;
  idNativo: string | null;
  estado: NotificationJobState;
  payloadMinimo: NotificationJobPayload;
  error: string | null;
  recibidaObservadaEn: string | null;
  abiertaEn: string | null;
  creadoEl: string;
  actualizadoEl: string;
}

export interface NotificationJobPayload {
  version: 1;
  notificacionId: string;
  revision: number;
  pacienteId: string;
  recordatorioId: string;
  tipo: ReminderType;
  medicamentoId?: string;
  destino: '/vitales/registrar' | '/perfil/medicacion';
}

export interface SaveReminderInput {
  id?: string;
  tipo: ReminderType;
  medicamentoId?: string | null;
  diasSemana: number[];
  horasMinutos: string[];
  zonaHoraria?: string;
  fechaInicio?: string | null;
  fechaFin?: string | null;
  habilitado?: boolean;
}

export type ReminderActivationIntent =
  | 'save_and_activate'
  | 'save_and_resume_all'
  | 'save_disabled'
  | 'keep_existing';

export interface SaveRuleWithActivationResult {
  rule: ReminderRule;
  preferencesEnabled: boolean;
  resumedGeneralPreference: boolean;
  pausedByGeneralPreference: boolean;
  otherEnabledRulesCount: number;
}

export interface SnapshotMedicationItem {
  id: string;
  nombre: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  estadoActivo: boolean;
}

export interface ReminderStatusSnapshot {
  patientId: string;
  nowIso: string;
  preferences: {
    enabled: boolean;
    updatedAt: string | null;
  };
  rules: ReminderRule[];
  futureNotifications: NotificationItem[];
  medications: SnapshotMedicationItem[];
  allEnabledRulesCount: number;
}

export const ALLOWED_NOTIFICATION_DESTINATIONS = new Set<string>([
  '/vitales/registrar',
  '/perfil/medicacion',
]);

export const ALLOWED_REMINDER_TYPES = new Set<ReminderType>(['registro_vitales', 'medicacion']);

export function isValidNotificationPayload(data: unknown): data is NotificationJobPayload {
  if (!data || typeof data !== 'object') return false;
  const p = data as Record<string, unknown>;
  return (
    p.version === 1 &&
    typeof p.notificacionId === 'string' &&
    p.notificacionId.length > 0 &&
    typeof p.pacienteId === 'string' &&
    p.pacienteId.length > 0 &&
    typeof p.recordatorioId === 'string' &&
    p.recordatorioId.length > 0 &&
    typeof p.revision === 'number' &&
    Number.isInteger(p.revision) &&
    p.revision >= 1 &&
    typeof p.tipo === 'string' &&
    ALLOWED_REMINDER_TYPES.has(p.tipo as ReminderType) &&
    (p.medicamentoId === undefined || typeof p.medicamentoId === 'string') &&
    typeof p.destino === 'string' &&
    ALLOWED_NOTIFICATION_DESTINATIONS.has(p.destino)
  );
}
