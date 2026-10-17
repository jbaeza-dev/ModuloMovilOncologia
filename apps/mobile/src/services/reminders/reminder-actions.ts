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
  saveRule: (input: SaveReminderInput) => Promise<ReminderRule>;
  saveRuleWithActivationIntent?: (
    input: SaveReminderInput,
    intent: ReminderActivationIntent,
  ) => Promise<SaveRuleWithActivationResult>;
  getReminderStatusSnapshot?: (nowIso?: string) => Promise<ReminderStatusSnapshot>;
  getPreferences?: () => Promise<{ enabled: boolean; updatedAt: string | null }>;
  setPreferences?: (enabled: boolean) => Promise<void>;
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

async function persistRuleTransactionalOrFallback(
  repo: ReminderActionsRepositoryPort,
  input: SaveReminderInput,
  intent: ReminderActivationIntent,
): Promise<SaveRuleWithActivationResult> {
  if (typeof repo.saveRuleWithActivationIntent === 'function') {
    return repo.saveRuleWithActivationIntent(input, intent);
  }

  // Respaldo compatible para dobles de prueba que solo implementan saveRule/getPreferences/setPreferences
  const shouldEnableRule = intent !== 'save_disabled';
  const currentPrefs =
    typeof repo.getPreferences === 'function'
      ? await repo.getPreferences()
      : { enabled: true, updatedAt: null };

  const rule = await repo.saveRule({
    ...input,
    habilitado: shouldEnableRule,
  });

  if (!shouldEnableRule) {
    return {
      rule,
      preferencesEnabled: currentPrefs.enabled,
      otherEnabledRulesCount: 0,
      resumedGeneralPreference: false,
      pausedByGeneralPreference: false,
    };
  }

  if (intent === 'keep_existing') {
    return {
      rule,
      preferencesEnabled: currentPrefs.enabled,
      otherEnabledRulesCount: 0,
      resumedGeneralPreference: false,
      pausedByGeneralPreference: !currentPrefs.enabled,
    };
  }

  if (!currentPrefs.enabled && typeof repo.setPreferences === 'function') {
    await repo.setPreferences(true);
    return {
      rule,
      preferencesEnabled: true,
      otherEnabledRulesCount: 0,
      resumedGeneralPreference: true,
      pausedByGeneralPreference: false,
    };
  }

  return {
    rule,
    preferencesEnabled: currentPrefs.enabled,
    otherEnabledRulesCount: 0,
    resumedGeneralPreference: false,
    pausedByGeneralPreference: !currentPrefs.enabled,
  };
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

  const wantsActivation = intent !== 'save_disabled';
  let permissionState: NotificationPermissionState = {
    status: 'granted',
    canAskAgain: true,
    channelStatus: 'ok',
  };

  if (wantsActivation) {
    permissionState = await notificationAdapter.getPermissionState();
    if (permissionState.status !== 'granted' && permissionState.canAskAgain) {
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

  // Si el usuario quería activar pero el permiso nativo fue denegado o el canal está bloqueado,
  // guardamos la regla habilitada pero sin levantar silenciosamente la pausa general si estaba activa.
  const effectiveIntent: ReminderActivationIntent =
    wantsActivation && !permissionGranted ? 'keep_existing' : intent;

  const saveResult = await persistRuleTransactionalOrFallback(
    remindersRepository,
    {
      ...input,
      habilitado: wantsActivation,
    },
    effectiveIntent,
  );
  bumpRemindersRevision?.();

  // Comprobar contexto después de la escritura antes de continuar
  if (!checkContext()) {
    return { kind: 'context_changed' };
  }

  if (!wantsActivation) {
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

  // Ajuste 1: evaluar específicamente la regla recién guardada (rule.id y rule.revision)
  // para distinguir `scheduled` (con ocurrencia futura confirmada de esta regla) de
  // `saved_no_upcoming`, `saved_pending_scheduling` o `saved_scheduling_failed`.
  if (typeof remindersRepository.getReminderStatusSnapshot === 'function') {
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

  // Si no hay getReminderStatusSnapshot (en un mock mínimo), verificar que al menos haya 1 confirmada
  if (coordinatorResult.programadasConfirmadas > 0) {
    return {
      kind: 'scheduled',
      rule: saveResult.rule,
      coordinatorResult,
    };
  }

  if (coordinatorResult.totalDeseadas === 0) {
    return {
      kind: 'saved_no_upcoming',
      rule: saveResult.rule,
      reason: 'starts_after_window',
      coordinatorResult,
    };
  }

  return {
    kind: 'saved_scheduling_failed',
    rule: saveResult.rule,
    coordinatorResult,
  };
}
