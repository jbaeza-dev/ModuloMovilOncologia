import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { GatewayRecordatorio } from '@quimiocare/contracts';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useProfileIdentity } from '../profile/IdentityProfileScreens';
import {
  generateIntakeLogId,
  getMedicationIntakesForDate,
  logMedicationIntake,
  type MedicationIntakeLogEntry,
} from '../../data/local/medication-intake-log';
import { agendaDate } from '@quimiocare/contracts/agenda';
import { medicationDay, type MedicationDayCard, type MedicationDaySlot } from './medication-day';

export function useMedicationDay() {
  const data = useLocalData(),
    profile = useProfileIdentity();
  const key = useMemo(
    () => ({
      db: data.database,
      agenda: data.sharedAgenda,
      patient: data.patientId,
      owner: profile.identity?.owner ?? null,
    }),
    [data.database, data.sharedAgenda, data.patientId, profile.identity?.owner],
  );
  const live = useRef({ data, profile, key });
  live.current = { data, profile, key };
  const [state, setState] = useState<{
    key: typeof key;
    rows: MedicationIntakeLogEntry[];
    rules: GatewayRecordatorio[];
    pendingIds: Set<string>;
    now: string;
    error: string | null;
  } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [saving, setSaving] = useState(false),
    lock = useRef(false),
    focused = useRef(false),
    request = useRef(0);
  useEffect(() => {
    lock.current = false;
    setSaving(false);
  }, [key]);
  const assert = useCallback(
    (epoch: number | undefined) => {
      const current = live.current;
      if (
        current.key !== key ||
        current.data.isClosing ||
        !key.patient ||
        (current.data.manager?.getPatientId &&
          current.data.manager.getPatientId() !== key.patient) ||
        current.data.manager?.getContextEpoch?.() !== epoch
      )
        throw new Error('La cuenta cambió. Vuelve a revisar tus medicamentos.');
    },
    [key],
  );
  const read = useCallback(async () => {
    const epoch = live.current.data.manager?.getContextEpoch?.();
    assert(epoch);
    if (!key.db || !key.patient) throw new Error('Aún no están disponibles los registros.');
    const now = new Date().toISOString();
    const [rows, agenda, pending] = await Promise.all([
      getMedicationIntakesForDate(key.db, key.patient, agendaDate(now)),
      key.agenda?.read() ?? Promise.resolve({ rules: [] as GatewayRecordatorio[] }),
      key.agenda?.repository.intents() ?? Promise.resolve([]),
    ]);
    assert(epoch);
    return {
      key,
      rows,
      rules: agenda.rules,
      pendingIds: new Set(pending.map((v) => v.id)),
      now,
      error: null,
    };
  }, [key, assert]);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const value = await read();
      if (live.current.key === key && request.current === id) setState(value);
    } catch {
      if (live.current.key === key && request.current === id)
        setState({
          key,
          rows: [],
          rules: [],
          pendingIds: new Set(),
          now: new Date().toISOString(),
          error: 'No pudimos cargar tus medicamentos y avisos. Vuelve a intentarlo.',
        });
    }
  }, [read, key]);
  useEffect(() => {
    void refresh();
    return () => {
      request.current++;
    };
  }, [refresh, data.remindersRevision]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setFocusTick((n) => n + 1);
      void refresh();
      let active = true;
      if (key.agenda)
        void live.current.data
          .reconcileReminders()
          .catch(() => undefined)
          .then(() => {
            if (active) void refresh();
          });
      return () => {
        active = false;
        focused.current = false;
      };
    }, [refresh, key.agenda]),
  );
  const ready = state?.key === key ? state : null;
  const medications = profile.identity?.clinicalProfile?.medicamentos ?? [];
  const model = useMemo(
    () =>
      medicationDay({
        medications,
        rules: ready?.rules ?? [],
        pendingIds: ready?.pendingIds ?? new Set(),
        intakes: ready?.rows ?? [],
        now: ready?.now ?? new Date().toISOString(),
      }),
    [medications, ready],
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clear();
      if (!focused.current || AppState.currentState !== 'active') return;
      timer = setTimeout(
        () => {
          if (focused.current && AppState.currentState === 'active') void refresh();
        },
        Math.max(100, Math.min(2147483647, Date.parse(model.nextRefreshAt) - Date.now() + 50)),
      );
    };
    schedule();
    const subscription = AppState.addEventListener('change', (next) => {
      clear();
      if (next === 'active') {
        setFocusTick((n) => n + 1);
        void refresh();
      }
    });
    return () => {
      clear();
      subscription.remove();
    };
  }, [model.nextRefreshAt, refresh, focusTick]);

  const confirm = (
    card: MedicationDayCard,
    slot: MedicationDaySlot,
    status: 'taken' | 'omitted',
  ) => {
    if (lock.current || !ready || ready.error || !slot.due || data.isClosing) return;
    const epoch = data.manager?.getContextEpoch?.(),
      medicine = JSON.stringify(card.medication),
      date = model.date;
    const label = status === 'taken' ? 'Ya la tomé' : 'No la tomé';
    Alert.alert(
      slot.intake ? 'Corregir confirmación' : 'Confirmar registro de dosis',
      `${card.medication.nombre || 'Medicamento'}${card.medication.dosis ? ' · ' + card.medication.dosis : ''}. Aviso del ${date} a las ${slot.time}.\n\nGuardar como «${label}». Sigue las indicaciones de tu equipo tratante.`,
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Confirmar registro',
          onPress: () => {
            if (lock.current) return;
            lock.current = true;
            setSaving(true);
            void (async () => {
              assert(epoch);
              const fresh = await read();
              const latest = medicationDay({
                medications: live.current.profile.identity?.clinicalProfile?.medicamentos ?? [],
                ...fresh,
                intakes: fresh.rows,
              });
              const currentCard = latest.cards.find((v) => v.medication.id === card.medication.id),
                currentSlot = currentCard?.slots.find((v) => v.key === slot.key);
              if (
                latest.date !== date ||
                !currentCard ||
                !currentSlot?.due ||
                currentSlot.signature !== slot.signature ||
                JSON.stringify(currentCard.medication) !== medicine
              )
                throw new Error(
                  'El medicamento, el día o el aviso cambió. Revisa el horario antes de confirmar.',
                );
              assert(epoch);
              const now = new Date().toISOString();
              await live.current.data.trackOperation(async () => {
                assert(epoch);
                await logMedicationIntake(key.db!, {
                  id: generateIntakeLogId(key.patient!, card.medication.id, date, slot.key),
                  paciente_id: key.patient!,
                  medicamento_id: card.medication.id,
                  medicamento_nombre: card.medication.nombre || 'Nombre no informado',
                  dosis: card.medication.dosis ?? null,
                  fecha_civil: date,
                  horario_programado: slot.key,
                  es_programado: 1,
                  fecha_hora: now,
                  estado: status,
                  registrado_en: now,
                  avisos_confirmados: currentSlot.notices,
                });
              });
              await refresh();
            })()
              .catch((error: unknown) => {
                if (live.current.key === key)
                  Alert.alert(
                    'No se guardó la confirmación',
                    error instanceof Error ? error.message : 'Vuelve a revisar el aviso.',
                  );
              })
              .finally(() => {
                lock.current = false;
                if (live.current.key === key) setSaving(false);
              });
          },
        },
      ],
    );
  };
  return {
    ...model,
    identity: profile.identity,
    loading: !ready,
    error: ready?.error ?? null,
    saving,
    confirm,
    refresh,
    isClosing: data.isClosing,
  };
}
