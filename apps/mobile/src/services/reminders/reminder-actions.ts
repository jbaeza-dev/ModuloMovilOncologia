import type {
  ReminderActivationIntent,
  ReminderRule,
  ReminderStatusSnapshot,
  SaveReminderInput,
  SaveRuleWithActivationResult,
} from '../../data/local/reminders/reminder-types';
import type {
  LocalNotificationAdapter,
  NotificationPermissionState,
} from '../notifications/notification-adapter';
import type { CoordinatorResult } from './notification-coordinator';
import { classifyReminderStatus, type NoUpcomingReason } from './reminder-status';

export type ReminderActionOutcome =
  | {
      kind: 'scheduled';
      rule: ReminderRule;
      coordinatorResult: CoordinatorResult;
    }
  | {
      kind: 'saved_pending_scheduling';
      rule: ReminderRule;
      reason: 'contexto_anterior' | 'cancelacion_regla_previa' | 'programacion_parcial';
      coordinatorResult: CoordinatorResult;
    }
  | {
      kind: 'saved_no_upcoming';
      rule: ReminderRule;
      reason: NoUpcomingReason;
      coordinatorResult: CoordinatorResult;
    }
  | {
      kind: 'saved_disabled';
      rule: ReminderRule;
      coordinatorResult: CoordinatorResult | null;
    }
  | {
      kind: 'saved_permission_denied';
      rule: ReminderRule;
      permissionState: NotificationPermissionState;
    }
  | {
      kind: 'saved_preferences_paused';
      rule: ReminderRule;
      otherEnabledRulesCount: number;
    }
  | {
      kind: 'saved_scheduling_failed';
      rule: ReminderRule;
      coordinatorResult: CoordinatorResult | null;
    }
  | {
      kind: 'context_changed';
    };

export interface ReminderActionsRepositoryPort {
  saveRuleWithActivationIntent: (
    input: SaveReminderInput,
    intent: ReminderActivationIntent,
  ) => Promise<SaveRuleWithActivationResult>;
  getReminderStatusSnapshot: (nowIso?: string) => Promise<ReminderStatusSnapshot>;
}

export interface SaveReminderWithActivationParams {
  patientId: string;
  contextEpoch: number;
  isContextActive?: (patientId: string, contextEpoch: number) => boolean;
  input: SaveReminderInput;
  intent: ReminderActivationIntent;
  remindersRepository: ReminderActionsRepositoryPort;
  notificationAdapter: Pick<LocalNotificationAdapter, 'getPermissionState' | 'requestPermission'>;
  reconcileReminders: (patientId: string) => Promise<CoordinatorResult | null>;
  bumpRemindersRevision?: () => void;
  nowIso?: () => string;
}

/**
 * Coordina el guardado de una regla de recordatorio con solicitud de permisos,
 * decisión transaccional sobre la preferencia general, reconciliación nativa y
 * verificación triple de `(patientId, contextEpoch)`.
 */
export async function saveReminderWithActivation(
  params: SaveReminderWithActivationParams,
): Promise<ReminderActionOutcome> {
  const {
    patientId,
    contextEpoch,
    isContextActive = () => true,
    input,
    intent,
    remindersRepository,
    notificationAdapter,
    reconcileReminders,
    bumpRemindersRevision,
    nowIso = () => new Date().toISOString(),
  } = params;

  const checkContext = () => isContextActive(patientId, contextEpoch);

  if (!checkContext()) {
    return { kind: 'context_changed' };
  }

  // Determinar si la regla resultante debe quedar habilitada
  const targetHabilitado =
    intent === 'save_and_activate' || intent === 'save_and_resume_all'
      ? true
      : intent === 'save_disabled'
        ? false
        : Boolean(input.habilitado);

  let permissionState: NotificationPermissionState = {
    status: 'granted',
    canAskAgain: true,
    channelStatus: 'ok',
  };

  if (targetHabilitado) {
    permissionState = await notificationAdapter.getPermissionState();
    // En edición ordinaria (keep_existing) no se solicita permiso al usuario,
    // únicamente se comprueba el estado actual de disponibilidad del dispositivo.
    if (
      intent !== 'keep_existing' &&
      permissionState.status !== 'granted' &&
      permissionState.canAskAgain
    ) {
      permissionState = await notificationAdapter.requestPermission();
    }

    // Frontera 1: tras regresar del diálogo de permiso nativo
    if (!checkContext()) {
      return { kind: 'context_changed' };
    }
  }

  // Frontera 2: inmediatamente antes de iniciar la escritura en SQLite
  if (!checkContext()) {
    return { kind: 'context_changed' };
  }

  const permissionGranted =
    permissionState.status === 'granted' && permissionState.channelStatus !== 'blocked';

  // Si se deseaba activar la preferencia general pero el permiso nativo fue denegado o el canal está bloqueado,
  // degradamos a keep_existing para no alterar la preferencia general si estaba activa la pausa.
  const effectiveIntent: ReminderActivationIntent =
    targetHabilitado && !permissionGranted && intent !== 'keep_existing' ? 'keep_existing' : intent;

  const saveResult = await remindersRepository.saveRuleWithActivationIntent(
    {
      ...input,
      habilitado: targetHabilitado,
    },
    effectiveIntent,
  );
  bumpRemindersRevision?.();

  // Comprobar contexto después de la escritura antes de continuar
  if (!checkContext()) {
    return { kind: 'context_changed' };
  }

  if (!targetHabilitado) {
    const coordinatorResult = await reconcileReminders(patientId);
    bumpRemindersRevision?.();
    if (!checkContext()) {
      return { kind: 'context_changed' };
    }
    return {
      kind: 'saved_disabled',
      rule: saveResult.rule,
      coordinatorResult,
    };
  }

  if (!permissionGranted) {
    return {
      kind: 'saved_permission_denied',
      rule: saveResult.rule,
      permissionState,
    };
  }

  if (saveResult.pausedByGeneralPreference) {
    return {
      kind: 'saved_preferences_paused',
      rule: saveResult.rule,
      otherEnabledRulesCount: saveResult.otherEnabledRulesCount,
    };
  }

  const coordinatorResult = await reconcileReminders(patientId);
  bumpRemindersRevision?.();

  // Frontera 3: antes de evaluar y publicar el resultado al llamador
  if (!checkContext()) {
    return { kind: 'context_changed' };
  }

  if (!coordinatorResult || coordinatorResult.status === 'error') {
    return {
      kind: 'saved_scheduling_failed',
      rule: saveResult.rule,
      coordinatorResult,
    };
  }

  if (coordinatorResult.status === 'programacion_pendiente') {
    return {
      kind: 'saved_pending_scheduling',
      rule: saveResult.rule,
      reason: coordinatorResult.motivoPendiente ?? 'programacion_parcial',
      coordinatorResult,
    };
  }

  // Evaluar específicamente la regla recién guardada (rule.id y rule.revision)
  // para distinguir `scheduled` (con ocurrencia futura confirmada de esta regla) de
  // `saved_no_upcoming`, `saved_pending_scheduling` o `saved_scheduling_failed`.
  const currentNow = nowIso();
  const snapshot = await remindersRepository.getReminderStatusSnapshot(currentNow);
  if (!checkContext()) {
    return { kind: 'context_changed' };
  }

  const evaluation = classifyReminderStatus(snapshot, {
    ruleId: saveResult.rule.id,
    permissionState,
    coordinatorResult,
    coordinatorInFlight: false,
  });

  if (evaluation.status === 'scheduled') {
    return {
      kind: 'scheduled',
      rule: saveResult.rule,
      coordinatorResult,
    };
  }

  if (evaluation.status === 'no_upcoming') {
    return {
      kind: 'saved_no_upcoming',
      rule: saveResult.rule,
      reason: evaluation.noUpcomingReason ?? 'starts_after_window',
      coordinatorResult,
    };
  }

  if (evaluation.status === 'pending_scheduling') {
    return {
      kind: 'saved_pending_scheduling',
      rule: saveResult.rule,
      reason: coordinatorResult.motivoPendiente ?? 'programacion_parcial',
      coordinatorResult,
    };
  }

  return {
    kind: 'saved_scheduling_failed',
    rule: saveResult.rule,
    coordinatorResult,
  };
}
