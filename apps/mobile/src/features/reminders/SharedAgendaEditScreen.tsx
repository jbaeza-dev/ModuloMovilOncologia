import { useProfileIdentity } from '../profile/IdentityProfileScreens';
import { medicationAvailable } from '@quimiocare/contracts/agenda';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import * as Crypto from 'expo-crypto';
import type { GatewayConfiguracionRecordatorio, GatewayRecordatorio } from '@quimiocare/contracts';
import { agendaDate } from '@quimiocare/contracts/agenda';
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
import { validConfiguration } from '../../data/agenda/agenda-repository';
const labels = { signos: 'Signos vitales', epro: 'Cuestionario diario', medicacion: 'Medicación' };
const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export function SharedAgendaEditScreen() {
  const { sharedAgenda: agenda, reconcileReminders, trackOperation } = useLocalData(),
    { theme } = useAppTheme(),
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
    [start, setStart] = useState(() => agendaDate(Date.now())),
    [end, setEnd] = useState(''),
    [active, setActive] = useState(true),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [confirmation, setConfirmation] = useState<'saved' | 'removed' | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (!agenda) return;
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
        setEnd(rule.fecha_fin ?? '');
        setActive(rule.activo);
      }
      setReady(true);
    });
    return () => {
      current = false;
    };
  }, [agenda, id, params.id]);
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
      <SectionTitle>Días de la semana</SectionTitle>
      <View style={{ gap: 8 }}>
        {days.map((label, index) => (
          <Pressable
            key={label}
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: weekdays.includes(index + 1), disabled: busy }}
            disabled={busy}
            onPress={() => {
              setWeekdays((current) =>
                current.includes(index + 1)
                  ? current.filter((v) => v !== index + 1)
                  : [...current, index + 1].sort((a, b) => a - b),
              );
              setDirty(true);
            }}
            style={{ padding: 14, borderRadius: 12, backgroundColor: theme.colors.surface }}
          >
            <Text style={{ color: theme.colors.text }}>
              {weekdays.includes(index + 1) ? '☑ ' : '☐ '}
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <DateTimePickerField
        mode="date"
        label="Fecha de inicio"
        value={start}
        onChange={update(setStart)}
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
