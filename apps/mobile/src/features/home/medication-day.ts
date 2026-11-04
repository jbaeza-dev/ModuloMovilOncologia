import type { ClinicalPerfilClinicoResponse, GatewayRecordatorio } from '@quimiocare/contracts';
import {
  agendaDate,
  agendaInstant,
  medicationAvailable,
  parseOccurrenceId,
  reminderOccurrence,
  shiftAgendaDate,
} from '@quimiocare/contracts/agenda';
import type {
  MedicationIntakeLogEntry,
  MedicationNoticeReference,
} from '../../data/local/medication-intake-log';

export type PatientMedication = NonNullable<ClinicalPerfilClinicoResponse['medicamentos']>[number];
export interface MedicationDaySlot {
  key: string;
  time: string;
  date: string;
  scheduledAt: string;
  due: boolean;
  notices: MedicationNoticeReference[];
  signature: string;
  intake: MedicationIntakeLogEntry | null;
}
export interface MedicationDayCard {
  medication: PatientMedication;
  slots: MedicationDaySlot[];
  confirmedRules: GatewayRecordatorio[];
  pendingChange: boolean;
  historical: MedicationIntakeLogEntry[];
}
function hasNoticeProof(entry: MedicationIntakeLogEntry, date: string, time: string): boolean {
  if (!entry.avisos_confirmados_json) return false;
  try {
    const refs: unknown = JSON.parse(entry.avisos_confirmados_json);
    return (
      Array.isArray(refs) &&
      refs.length > 0 &&
      refs.length <= 100 &&
      refs.every((ref) => {
        if (!ref || typeof ref !== 'object') return false;
        const parsed =
          typeof ref.occurrenceId === 'string' ? parseOccurrenceId(ref.occurrenceId) : null;
        return (
          parsed &&
          parsed.id === ref.reminderId &&
          parsed.version === ref.version &&
          parsed.date === date &&
          parsed.time === time &&
          ref.date === date &&
          ref.time === time &&
          ref.timezone === 'America/Santiago' &&
          ref.scheduledAt === agendaInstant(date, time)
        );
      })
    );
  } catch {
    return false;
  }
}
export function medicationDay(input: {
  medications: PatientMedication[];
  rules: GatewayRecordatorio[];
  pendingIds: ReadonlySet<string>;
  intakes: MedicationIntakeLogEntry[];
  now: string;
}): { date: string; cards: MedicationDayCard[]; nextRefreshAt: string } {
  const date = agendaDate(input.now),
    now = Date.parse(input.now);
  const cards = input.medications
    .filter((m) => medicationAvailable(m, date))
    .map((medication): MedicationDayCard => {
      const bound = input.rules.filter(
        (r) =>
          r.tipo === 'medicacion' &&
          r.medicamento_paciente_id?.toLowerCase() === medication.id.toLowerCase(),
      );
      const confirmedRules = bound.filter((r) => !input.pendingIds.has(r.id));
      const groups = new Map<string, MedicationNoticeReference[]>();
      for (const rule of confirmedRules)
        for (const time of rule.horas) {
          const occurrence = reminderOccurrence(rule, date, time);
          if (!occurrence) continue;
          const refs = groups.get(time) ?? [];
          refs.push({
            reminderId: rule.id,
            version: rule.version,
            occurrenceId: occurrence.ocurrencia_id,
            scheduledAt: occurrence.programado_en,
            date,
            time,
            timezone: 'America/Santiago',
          });
          groups.set(time, refs);
        }
      const records = input.intakes.filter(
        (entry) =>
          entry.medicamento_id.toLowerCase() === medication.id.toLowerCase() &&
          entry.fecha_civil === date,
      );
      const slots = [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([time, notices]): MedicationDaySlot => {
          notices.sort((a, b) => a.occurrenceId.localeCompare(b.occurrenceId));
          const key = 'aviso#' + time,
            scheduledAt = notices[0]!.scheduledAt;
          return {
            key,
            time,
            date,
            scheduledAt,
            due: now >= Date.parse(scheduledAt),
            notices,
            signature: JSON.stringify(notices),
            intake:
              records.find(
                (entry) =>
                  entry.horario_programado === key &&
                  entry.es_programado === 1 &&
                  hasNoticeProof(entry, date, time),
              ) ?? null,
          };
        });
      return {
        medication,
        slots,
        confirmedRules,
        pendingChange: bound.some((r) => input.pendingIds.has(r.id)),
        historical: records.filter((entry) => !slots.some((slot) => slot.intake?.id === entry.id)),
      };
    });
  const next = [
    agendaInstant(shiftAgendaDate(date, 1), '00:00'),
    ...cards.flatMap((card) =>
      card.slots.filter((slot) => !slot.due).map((slot) => slot.scheduledAt),
    ),
  ].sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
  return { date, cards, nextRefreshAt: next };
}
