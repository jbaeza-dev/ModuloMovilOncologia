import type { GatewayRecordatorio } from '@quimiocare/contracts';
import { upcomingAgendaOccurrences } from '@quimiocare/contracts/agenda';
import type { ReminderStatusEvaluation } from '../reminders/reminder-status';
import type { AgendaCoverage } from './agenda-coordinator';
export function sharedReminderStatus(
  rules: GatewayRecordatorio[],
  completed: ReadonlySet<string>,
  jobs: { occurrence_id: string; native_id: string; state: string }[],
  coverage: AgendaCoverage | null,
  now: string,
  kind: 'signos' | 'medicacion' = 'signos',
  ruleId?: string | null,
): ReminderStatusEvaluation {
  const own = rules.filter((r) => r.tipo === kind && (!ruleId || r.id === ruleId)),
    enabled = own.filter((r) => r.activo),
    first = own[0],
    window = upcomingAgendaOccurrences(enabled, now, completed);
  const confirmed = window.occurrences.find((o) =>
    jobs.some(
      (j) =>
        j.occurrence_id === o.ocurrencia_id &&
        j.state === 'scheduled' &&
        coverage?.nativeIds?.includes(j.native_id),
    ),
  );
  const next = confirmed ?? window.occurrences[0];
  const status: ReminderStatusEvaluation['status'] = !own.length
    ? 'no_configured'
    : !enabled.length
      ? 'rule_disabled'
      : !next
        ? 'no_upcoming'
        : confirmed
          ? 'scheduled'
          : 'pending_scheduling';
  return {
    status,
    deviceAvailability: coverage?.permission ? 'available' : 'permission_required',
    ruleId: next?.recordatorio_id ?? first?.id ?? null,
    rulesCount: own.length,
    enabledRulesCount: enabled.length,
    allEnabledRulesCount: rules.filter((r) => r.activo).length,
    otherEnabledRulesCount: rules.filter((r) => r.activo && r.tipo !== kind).length,
    notificationId: next?.ocurrencia_id ?? null,
    fechaPrevistaUtc: next?.respaldo_en ?? null,
    fechaCivilLocal: next?.fecha_local ?? null,
    horaMinutoLocal: next?.hora_local ?? null,
    zonaHoraria: 'America/Santiago',
    noUpcomingReason: status === 'no_upcoming' ? 'no_matching_days' : null,
    fechaInicio: first?.fecha_inicio ?? null,
    fechaFin: first?.fecha_fin ?? null,
    cubiertoHastaIso: coverage?.until ?? null,
    truncadas: coverage?.truncated ?? 0,
  };
}
