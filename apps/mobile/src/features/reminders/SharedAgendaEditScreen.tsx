import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import * as Crypto from 'expo-crypto';
import type { GatewayConfiguracionRecordatorio, GatewayRecordatorio } from '@quimiocare/contracts';
import { agendaDate } from '@quimiocare/contracts/agenda';
import { Screen } from '../../components/Screen';
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
    params = useLocalSearchParams<{ id?: string; tipo?: string }>();
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
          };
          if (!validConfiguration(config))
            throw new Error(
              'Revisa el título, entre 1 y 8 horas HH:mm sin repetir, al menos un día y las fechas AAAA-MM-DD en orden.',
            );
          await agenda.save(id, config, old?.version);
        }
        await reconcileReminders();
      });
      setDone(true);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : 'No se confirmó el cambio.') +
          ' El horario solo cambia al recibir confirmación. Revisa la agenda si quedó una intención pendiente.',
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (done) router.back();
  }, [done]);
  return (
    <Screen title={old ? 'Editar recordatorio' : 'Nuevo recordatorio'}>
      <BodyText>
        Los horarios se comparten entre tus dispositivos. Guardar requiere conexión. No se infieren
        dosis ni tratamientos.
      </BodyText>
      {error && (
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
      <VisualField
        label="Horas (HH:mm, separadas por coma)"
        value={hours}
        onChangeText={update(setHours)}
        editable={!busy}
        helperText="Ejemplo: 08:00, 14:00, 20:00. Máximo 8 horas distintas."
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
                  : [...current, index + 1].sort(),
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
      <VisualField
        label="Fecha de inicio (AAAA-MM-DD)"
        value={start}
        onChangeText={update(setStart)}
        editable={!busy}
      />
      <VisualField
        label="Fecha de término, opcional (AAAA-MM-DD)"
        value={end}
        onChangeText={update(setEnd)}
        editable={!busy}
      />
      <InfoCard>
        <BodyText>
          Se usará la hora de America/Santiago aunque cambies la zona horaria del teléfono. Los
          recordatorios de signos y cuestionario se omiten el día en que guardes ese tipo de
          registro completo; los de medicación no se marcan como cumplidos automáticamente.
        </BodyText>
      </InfoCard>
      <VisualButton
        label={busy ? 'Esperando confirmación…' : 'Guardar y confirmar horario'}
        disabled={busy || !ready}
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
              'Se cancelarán sus avisos pendientes cuando este teléfono pueda conciliar la agenda.',
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
