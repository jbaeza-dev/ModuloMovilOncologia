import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReminderStatusSnapshot, ReminderType } from '../data/local/reminders/reminder-types';
import { useLocalData } from '../providers/LocalDataProvider';
import type { NotificationPermissionState } from '../services/notifications/notification-adapter';
import {
  classifyReminderStatus,
  createQueryErrorReminderStatus,
  type ReminderStatusEvaluation,
} from '../services/reminders/reminder-status';

export interface UseReminderStatusOptions {
  tipo?: ReminderType;
  medicamentoId?: string | null;
  ruleId?: string | null;
  now?: () => string;
}

interface ScopedSnapshotState {
  patientId: string;
  contextEpoch: number;
  snapshot: ReminderStatusSnapshot | null;
  permissionState: NotificationPermissionState | null;
  queryError: boolean;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

export function useReminderStatus(options: UseReminderStatusOptions = {}) {
  const {
    repository,
    patientId,
    manager,
    remindersRevision = 0,
    scopedCoordinatorState = null,
    notificationAdapter,
    reconcileReminders,
  } = useLocalData();

  const tipo = options.tipo ?? 'registro_vitales';
  const medicamentoId = options.medicamentoId;
  const ruleId = options.ruleId;
  const nowFnRef = useRef(options.now);
  nowFnRef.current = options.now;

  const currentEpoch = manager?.getContextEpoch?.() ?? 0;

  const [scopedState, setScopedState] = useState<ScopedSnapshotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [localRefreshTick, setLocalRefreshTick] = useState(0);
  const [retryingScheduling, setRetryingScheduling] = useState(false);

  const mountedRef = useRef(true);
  const focusedRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setLocalRefreshTick((t) => t + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      const reqId = ++requestIdRef.current;
      const targetPatientId = patientId;
      const targetEpoch = manager?.getContextEpoch?.() ?? 0;

      if (!repository || !targetPatientId) {
        setScopedState(null);
        setLoading(false);
        return () => {
          focusedRef.current = false;
        };
      }

      setLoading(true);
      const nowIso = nowFnRef.current ? nowFnRef.current() : new Date().toISOString();

      const loadSnapshotPromise = repository.reminders.getReminderStatusSnapshot(nowIso);
      const loadPermissionPromise: Promise<NotificationPermissionState | null> = notificationAdapter
        ? notificationAdapter.getPermissionState().catch(() => null)
        : Promise.resolve(null);

      void Promise.all([loadSnapshotPromise, loadPermissionPromise])
        .then(([snapshot, permissionState]) => {
          if (!mountedRef.current || requestIdRef.current !== reqId) return;
          const livePatientId = manager?.getPatientId?.() ?? patientId;
          const liveEpoch = manager?.getContextEpoch?.() ?? 0;
          if (livePatientId !== targetPatientId || liveEpoch !== targetEpoch) return;

          setScopedState({
            patientId: targetPatientId,
            contextEpoch: targetEpoch,
            snapshot,
            permissionState,
            queryError: false,
          });
          setLoading(false);
        })
        .catch(() => {
          if (!mountedRef.current || requestIdRef.current !== reqId) return;
          const livePatientId = manager?.getPatientId?.() ?? patientId;
          const liveEpoch = manager?.getContextEpoch?.() ?? 0;
          if (livePatientId !== targetPatientId || liveEpoch !== targetEpoch) return;

          setScopedState({
            patientId: targetPatientId,
            contextEpoch: targetEpoch,
            snapshot: null,
            permissionState: null,
            queryError: true,
          });
          setLoading(false);
        });

      return () => {
        focusedRef.current = false;
      };
    }, [repository, patientId, manager, notificationAdapter, remindersRevision, localRefreshTick]),
  );

  const validScopedState =
    scopedState && scopedState.patientId === patientId && scopedState.contextEpoch === currentEpoch
      ? scopedState
      : null;

  const validCoordinatorState =
    scopedCoordinatorState &&
    scopedCoordinatorState.patientId === patientId &&
    scopedCoordinatorState.contextEpoch === currentEpoch
      ? scopedCoordinatorState
      : null;

  const evaluation = useMemo<ReminderStatusEvaluation>(() => {
    if (!validScopedState) {
      return createQueryErrorReminderStatus();
    }
    if (validScopedState.queryError || !validScopedState.snapshot) {
      return createQueryErrorReminderStatus();
    }
    return classifyReminderStatus(validScopedState.snapshot, {
      tipo,
      medicamentoId,
      ruleId,
      permissionState: validScopedState.permissionState,
      coordinatorInFlight: validCoordinatorState?.inFlight ?? false,
      coordinatorResult:
        validCoordinatorState && !validCoordinatorState.inFlight
          ? validCoordinatorState.result
          : null,
    });
  }, [validScopedState, validCoordinatorState, tipo, medicamentoId, ruleId]);

  const isCurrentPatientLoaded = validScopedState !== null && !loading;

  // Temporizador de una sola ejecución para invalidar cuando llega la hora del próximo aviso
  useEffect(() => {
    if (
      !focusedRef.current ||
      !isCurrentPatientLoaded ||
      evaluation.status !== 'scheduled' ||
      !evaluation.fechaPrevistaUtc
    ) {
      return;
    }

    const nowMs = nowFnRef.current ? new Date(nowFnRef.current()).getTime() : Date.now();
    const targetMs = new Date(evaluation.fechaPrevistaUtc).getTime();
    if (Number.isNaN(targetMs)) return;

    const rawDelay = Math.max(50, targetMs - nowMs + 25);
    const delay = Math.min(rawDelay, MAX_TIMEOUT_MS);

    const timer = setTimeout(() => {
      if (mountedRef.current && focusedRef.current) {
        setLocalRefreshTick((t) => t + 1);
      }
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [
    isCurrentPatientLoaded,
    evaluation.status,
    evaluation.fechaPrevistaUtc,
    patientId,
    currentEpoch,
  ]);

  const retryScheduling = useCallback(async () => {
    if (!patientId || !reconcileReminders) return;
    const targetPatientId = patientId;
    const targetEpoch = manager?.getContextEpoch?.() ?? 0;
    setRetryingScheduling(true);
    try {
      await reconcileReminders(targetPatientId);
      if (
        mountedRef.current &&
        (manager?.getPatientId?.() ?? patientId) === targetPatientId &&
        (manager?.getContextEpoch?.() ?? 0) === targetEpoch
      ) {
        setLocalRefreshTick((t) => t + 1);
      }
    } finally {
      if (mountedRef.current) {
        setRetryingScheduling(false);
      }
    }
  }, [patientId, reconcileReminders, manager]);

  return {
    loading: !isCurrentPatientLoaded,
    evaluation,
    snapshot: validScopedState?.snapshot ?? null,
    retryingScheduling,
    refresh,
    retryScheduling,
  };
}
