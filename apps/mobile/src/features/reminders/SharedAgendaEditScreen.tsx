import { useProfileIdentity } from '../profile/IdentityProfileScreens';
import { medicationAvailable } from '@quimiocare/contracts/agenda';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import * as Crypto from 'expo-crypto';
import type { GatewayConfiguracionRecordatorio, GatewayRecordatorio } from '@quimiocare/contracts';
import { agendaDate } from '@quimiocare/contracts/agenda';
import { useCivilDay } from '../../hooks/use-civil-day';
import { Screen } from '../../components/Screen';
import { DateTimePickerField } from '../../components/DateTimePickerField';
import {
  BodyText,
  InfoCard,
  VisualButton,
  VisualField,
  SectionTitle,
} from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import type { AppTheme } from '../../theme';
import { validConfiguration } from '../../data/agenda/agenda-repository';

const labels = { signos: 'Signos vitales', epro: 'Cuestionario diario', medicacion: 'Medicación' };

const DAYS_CONFIG = [
  { id: 1, label: 'Lunes', short: 'Lu' },
  { id: 2, label: 'Martes', short: 'Ma' },
  { id: 3, label: 'Miércoles', short: 'Mi' },
  { id: 4, label: 'Jueves', short: 'Ju' },
  { id: 5, label: 'Viernes', short: 'Vi' },
  { id: 6, label: 'Sábado', short: 'Sá' },
  { id: 7, label: 'Domingo', short: 'Do' },
];

function getWeekdaysSummary(selected: number[]): string {
  if (selected.length === 7) return 'Todos los días';
  if (selected.length === 5 && [1, 2, 3, 4, 5].every((d) => selected.includes(d))) {
    return 'Lunes a viernes (días hábiles)';
  }
  if (selected.length === 2 && [6, 7].every((d) => selected.includes(d))) {
    return 'Fines de semana (sábado y domingo)';
  }
  if (selected.length === 0) return 'Sin días seleccionados (marca al menos uno)';
  const names = selected
    .map((id) => DAYS_CONFIG.find((d) => d.id === id)?.short)
    .filter(Boolean)
    .join(', ');
  return `${selected.length} día${selected.length > 1 ? 's' : ''} a la semana (${names})`;
}
export function SharedAgendaEditScreen() {
  const { sharedAgenda: agenda, reconcileReminders, trackOperation } = useLocalData(),
    { theme } = useAppTheme(),
    styles = createStyles(theme),
    navigation = useNavigation(),
    params = useLocalSearchParams<{ id?: string; tipo?: string; medicamentoId?: string }>();
  const { identity } = useProfileIdentity();
  const available = (identity?.clinicalProfile?.medicamentos ?? []).filter((m) =>
    medicationAvailable(m, agendaDate(Date.now())),
  );
  const [medicationId, setMedicationId] = useState(
    typeof params.medicamentoId === 'string' ? params.medicamentoId : '',
  );
  const [id] = useState(() => (typeof params.id === 'string' ? params.id : Crypto.randomUUID())),
    [old, setOld] = useState<GatewayRecordatorio | null>(null),
    [ready, setReady] = useState(false),
    [title, setTitle] = useState(''),
    [kind, setKind] = useState<GatewayConfiguracionRecordatorio['tipo']>(
      params.tipo === 'medicacion' ? 'medicacion' : params.tipo === 'epro' ? 'epro' : 'signos',
    ),
    [hours, setHours] = useState('08:00'),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6, 7]),
    today = useCivilDay(),
    [start, setStart] = useState(today),
    [startChosen, setStartChosen] = useState(false),
    [end, setEnd] = useState(''),
    [active, setActive] = useState(true),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [confirmation, setConfirmation] = useState<'saved' | 'removed' | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (!agenda || ready) return;
    void agenda.read().then((snapshot) => {
      if (!current) return;
      const rule = snapshot.rules.find((v) => v.id === id);
      if (params.id && !rule) {
        setError('Actualiza la agenda antes de editar este horario.');
        return;
      }
      if (rule) {
        setOld(rule);
        setTitle(rule.titulo);
        setKind(rule.tipo);
        setMedicationId(rule.medicamento_paciente_id ?? '');
        setHours(rule.horas.join(', '));
        setWeekdays(rule.dias_semana);
        setStart(rule.fecha_inicio);
        setStartChosen(true);
        setEnd(rule.fecha_fin ?? '');
        setActive(rule.activo);
      }
      setReady(true);
    });
    return () => {
      current = false;
    };
  }, [agenda, id, params.id, ready]);
  // Un horario nuevo empieza «hoy»: si el formulario cruza la medianoche y el paciente no eligió
  // otra fecha, la de inicio pasa al día nuevo. Un horario existente conserva la suya.
  useEffect(() => {
    if (!params.id && !startChosen) setStart(today);
  }, [today, params.id, startChosen]);
  usePreventRemove(dirty && !done, ({ data }) =>
    Alert.alert('¿Descartar los cambios?', 'El horario confirmado se conserva.', [
      { text: 'Seguir editando', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]),
  );
  const update =
    <T,>(setter: (v: T) => void) =>
    (value: T) => {
      setter(value);
      setDirty(true);
    };
  const submit = async (remove = false) => {
    if (!agenda || !ready) return;
    setBusy(true);
    setError(null);
    let confirmed: 'saved' | 'removed' | null = null;
    try {
      await trackOperation(async () => {
        if (remove && old) await agenda.remove(id, old.version);
        else {
          const config: GatewayConfiguracionRecordatorio = {
            tipo: kind,
            titulo: title.trim(),
            zona_horaria: 'America/Santiago',
            horas: hours.split(',').map((v) => v.trim()),
            dias_semana: weekdays,
            fecha_inicio: start.trim(),
            fecha_fin: end.trim() || null,
            activo: active,
            ...(kind === 'medicacion' ? { medicamento_paciente_id: medicationId || null } : {}),
          };
          if (kind === 'medicacion' && active && !available.some((m) => m.id === medicationId))
            throw new Error('Selecciona un medicamento disponible de tu lista.');
          if (!validConfiguration(config))
            throw new Error(
              'Revisa el título, elige de uno a ocho horarios distintos, al menos un día y una fecha de término posterior al inicio.',
            );
          await agenda.save(id, config, old?.version);
        }
        confirmed = remove && old ? 'removed' : 'saved';
        setConfirmation(confirmed);
        setDirty(false);
        await reconcileReminders();
      });
      setDone(true);
    } catch (e) {
      setError(
        confirmed
          ? 'El servidor confirmó el cambio, pero no se pudieron actualizar los avisos de este teléfono. ' +
              (e instanceof Error ? e.message : 'Revisa el estado de los avisos en tu agenda.')
          : (e instanceof Error ? e.message : 'No se confirmó el cambio.') +
              ' El horario solo cambia al recibir confirmación. Revisa la agenda si quedó una intención pendiente.',
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (done) router.back();
  }, [done]);
  if (confirmation && !done)
    return (
      <Screen
        mascotPose="recordatorio"
        title={confirmation === 'removed' ? 'Recordatorio eliminado' : 'Horario confirmado'}
      >
        <InfoCard>
          <SectionTitle>
            {confirmation === 'removed' ? 'El cambio se confirmó' : 'Tu horario está guardado'}
          </SectionTitle>
          <BodyText>
            {busy
              ? 'El servidor ya confirmó el cambio. Estamos actualizando los avisos del teléfono.'
              : confirmation === 'removed'
                ? 'El servidor confirmó la eliminación. Queda pendiente retirar los avisos de este teléfono.'
                : 'El servidor confirmó tu horario. Queda pendiente actualizar los avisos en este teléfono.'}
          </BodyText>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>
              {error}
            </Text>
          ) : null}
          <VisualButton
            label="Volver a mis recordatorios"
            disabled={busy}
            onPress={() => setDone(true)}
          />
        </InfoCard>
      </Screen>
    );
  return (
    <Screen mascotPose="recordatorio" title={old ? 'Editar recordatorio' : 'Nuevo recordatorio'}>
      <BodyText>Elige tus avisos. No cambian las indicaciones de tu equipo de salud.</BodyText>
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>
          {error}
        </Text>
      )}
      <VisualField
        label="Título del recordatorio"
        value={title}
        onChangeText={update(setTitle)}
        maxLength={80}
        editable={ready && !busy}
      />
      <SectionTitle>Qué deseas recordar</SectionTitle>
      <View style={{ gap: 8 }}>
        {(['signos', 'epro', 'medicacion'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: kind === value, disabled: busy }}
            onPress={() => {
              setKind(value);
              setDirty(true);
            }}
            disabled={busy}
            style={{
              padding: 16,
              borderWidth: 1,
              borderColor: theme.colors.primary,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: theme.colors.text }}>
              {kind === value ? '● ' : '○ '}
              {labels[value]}
            </Text>
          </Pressable>
        ))}
      </View>
      {kind === 'medicacion' ? (
        <InfoCard>
          <SectionTitle>Medicamento de este aviso</SectionTitle>
          <BodyText>
            Elige el medicamento de tu lista. La asociación y los horarios se guardan cuando
            confirmas este aviso.
          </BodyText>
          {available.map((med) => (
            <Pressable
              key={med.id}
              accessibilityRole="radio"
              accessibilityLabel={`Seleccionar ${med.nombre || 'medicamento sin nombre'}`}
              accessibilityState={{ checked: medicationId === med.id, disabled: busy || !ready }}
              disabled={busy || !ready}
              onPress={() => {
                setMedicationId(med.id);
                setDirty(true);
              }}
              style={{
                padding: 16,
                borderWidth: 1,
                borderColor: theme.colors.primary,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: theme.colors.text }}>
                {medicationId === med.id ? '● ' : '○ '}
                {med.nombre || 'Nombre no informado'}
              </Text>
              {med.dosis ? (
                <Text style={{ color: theme.colors.text }}>Dosis indicada: {med.dosis}</Text>
              ) : null}
            </Pressable>
          ))}
          {!available.length ? (
            <BodyText>
              No hay medicamentos disponibles para asociar. Revisa tus indicaciones.
            </BodyText>
          ) : null}
          {old?.tipo === 'medicacion' && !old.medicamento_paciente_id ? (
            <BodyText>
              Este aviso anterior aún no tiene medicamento asociado. Selecciónalo para habilitar sus
              confirmaciones.
            </BodyText>
          ) : null}
        </InfoCard>
      ) : null}
      <SectionTitle>Horarios del aviso</SectionTitle>
      {hours.split(',').map((hour, index, current) => (
        <InfoCard key={index}>
          <DateTimePickerField
            mode="time"
            label={`Horario ${index + 1}`}
            value={hour.trim()}
            disabled={!ready || busy}
            onChange={(value) => {
              const next = [...current];
              next[index] = value;
              update(setHours)(next.join(', '));
            }}
          />
          {current.length > 1 ? (
            <VisualButton
              secondary
              label={`Quitar horario ${index + 1}`}
              disabled={!ready || busy}
              onPress={() =>
                update(setHours)(current.filter((_, position) => position !== index).join(', '))
              }
            />
          ) : null}
        </InfoCard>
      ))}
      <VisualButton
        secondary
        label="Añadir otro horario"
        disabled={!ready || busy || hours.split(',').length >= 8}
        onPress={() => {
          const current = hours.split(',').map((hour) => hour.trim());
          const available = Array.from(
            { length: 24 },
            (_, hour) => `${String(hour).padStart(2, '0')}:00`,
          ).find((hour) => !current.includes(hour));
          if (available) update(setHours)([...current, available].join(', '));
        }}
      />
      <InfoCard>
        <SectionTitle>Días de la semana</SectionTitle>
        <BodyText style={{ marginBottom: 12, color: theme.colors.secondary }}>
          {getWeekdaysSummary(weekdays)}
        </BodyText>

        <View style={styles.daysRow}>
          {DAYS_CONFIG.map((day) => {
            const isSelected = weekdays.includes(day.id);
            return (
              <Pressable
                key={day.id}
                accessibilityRole="checkbox"
                accessibilityLabel={day.label}
                accessibilityState={{ checked: isSelected, disabled: busy }}
                disabled={busy}
                onPress={() => {
                  setWeekdays((current) =>
                    current.includes(day.id)
                      ? current.filter((v) => v !== day.id)
                      : [...current, day.id].sort((a, b) => a - b),
                  );
                  setDirty(true);
                }}
                style={({ pressed }) => [
                  styles.dayButton,
                  isSelected && styles.dayButtonSelected,
                  pressed && styles.dayButtonPressed,
                ]}
              >
                <Text style={[styles.dayButtonText, isSelected && styles.dayButtonTextSelected]}>
                  {day.short}
                </Text>
                <View style={[styles.dayIndicator, isSelected && styles.dayIndicatorSelected]} />
              </Pressable>
            );
          })}
        </View>

        <View style={styles.presetsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Seleccionar todos los días"
            disabled={busy}
            onPress={() => {
              setWeekdays([1, 2, 3, 4, 5, 6, 7]);
              setDirty(true);
            }}
            style={[styles.presetChip, weekdays.length === 7 && styles.presetChipActive]}
          >
            <Text
              style={[styles.presetChipText, weekdays.length === 7 && styles.presetChipTextActive]}
            >
              Todos
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Seleccionar lunes a viernes"
            disabled={busy}
            onPress={() => {
              setWeekdays([1, 2, 3, 4, 5]);
              setDirty(true);
            }}
            style={[
              styles.presetChip,
              weekdays.length === 5 &&
                [1, 2, 3, 4, 5].every((d) => weekdays.includes(d)) &&
                styles.presetChipActive,
            ]}
          >
            <Text
              style={[
                styles.presetChipText,
                weekdays.length === 5 &&
                  [1, 2, 3, 4, 5].every((d) => weekdays.includes(d)) &&
                  styles.presetChipTextActive,
              ]}
            >
              Lun a Vie
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Seleccionar fines de semana"
            disabled={busy}
            onPress={() => {
              setWeekdays([6, 7]);
              setDirty(true);
            }}
            style={[
              styles.presetChip,
              weekdays.length === 2 &&
                [6, 7].every((d) => weekdays.includes(d)) &&
                styles.presetChipActive,
            ]}
          >
            <Text
              style={[
                styles.presetChipText,
                weekdays.length === 2 &&
                  [6, 7].every((d) => weekdays.includes(d)) &&
                  styles.presetChipTextActive,
              ]}
            >
              Fin de semana
            </Text>
          </Pressable>
        </View>
      </InfoCard>
      <DateTimePickerField
        mode="date"
        label="Fecha de inicio"
        value={start}
        onChange={(value: string) => {
          setStartChosen(true);
          update(setStart)(value);
        }}
        disabled={!ready || busy}
      />
      <DateTimePickerField
        mode="date"
        label="Fecha de término, opcional"
        value={end || null}
        onChange={update(setEnd)}
        minimumDate={start}
        placeholder="Sin fecha de término"
        disabled={!ready || busy}
      />
      {end ? (
        <VisualButton
          secondary
          label="Dejar sin fecha de término"
          disabled={busy}
          onPress={() => update(setEnd)('')}
        />
      ) : null}
      <InfoCard>
        <BodyText>
          Los avisos mantienen la hora de Chile. Las tomas se registran por separado.
        </BodyText>
      </InfoCard>
      <VisualButton
        label={busy ? 'Esperando confirmación…' : 'Guardar y confirmar horario'}
        disabled={
          busy ||
          !ready ||
          (kind === 'medicacion' && active && !available.some((m) => m.id === medicationId))
        }
        onPress={() => void submit()}
      />
      {old && (
        <VisualButton
          label="Eliminar recordatorio"
          secondary
          disabled={busy}
          onPress={() =>
            Alert.alert(
              '¿Eliminar este recordatorio?',
              'Sus avisos pendientes se cancelarán cuando se confirme el cambio.',
              [
                { text: 'Conservar', style: 'cancel' },
                { text: 'Eliminar', style: 'destructive', onPress: () => void submit(true) },
              ],
            )
          }
        />
      )}
    </Screen>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    daysRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    dayButton: {
      flex: 1,
      maxWidth: 44,
      height: 50,
      marginHorizontal: 2,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
    },
    dayButtonSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
      elevation: 2,
      shadowColor: theme.colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3,
    },
    dayButtonPressed: {
      opacity: 0.8,
    },
    dayButtonText: {
      fontSize: 15,
      fontFamily: theme.typography.label.fontFamily,
      fontWeight: '700',
      color: theme.colors.text,
    },
    dayButtonTextSelected: {
      color: theme.colors.onPrimary,
    },
    dayIndicator: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      marginTop: 4,
      backgroundColor: 'transparent',
    },
    dayIndicatorSelected: {
      backgroundColor: theme.colors.onPrimary,
    },
    presetsRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 4,
    },
    presetChip: {
      flex: 1,
      minHeight: 36,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    presetChipActive: {
      backgroundColor: theme.colors.primaryContainer,
      borderColor: theme.colors.primary,
    },
    presetChipText: {
      fontSize: 13,
      fontFamily: theme.typography.label.fontFamily,
      fontWeight: '600',
      color: theme.colors.secondary,
    },
    presetChipTextActive: {
      color: theme.colors.primary,
      fontWeight: '700',
    },
  });
