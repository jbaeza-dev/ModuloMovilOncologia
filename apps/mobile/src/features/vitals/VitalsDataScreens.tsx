import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  ChoiceChip,
  DetailRow,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import {
  formatDate,
  formatVital,
  sinceDays,
  type VitalWithSyncRecord,
} from '../../data/local/repository';
import { useFocusedList, useFocusedValue } from '../../hooks/use-local-query';
import { InputError, parseVitalInput, type VitalInput } from '../../data/local/validation';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

const pendingLabel = 'Guardado en este dispositivo · Pendiente de sincronización';
const initialValues: VitalInput = {
  temperature: '',
  systolic: '',
  diastolic: '',
  pulse: '',
  saturation: '',
};

function RecordCard({ item }: { item: VitalWithSyncRecord }) {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const syncLabel =
    item.estado_envio === 'pendiente' || !item.estado_envio
      ? 'Pendiente de sincronización'
      : `Estado: ${item.estado_envio}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'Ver registro del ' + formatDate(item.fecha_registro)}
      onPress={() => router.navigate({ pathname: '/vitales/detalle', params: { id: item.id } })}
      style={styles.record}
    >
      <View style={styles.row}>
        <Text style={styles.recordTitle}>{formatDate(item.fecha_registro)}</Text>
        <Feather name="chevron-right" size={20} color={appTheme.colors.text} />
      </View>
      <Text style={styles.small}>
        {formatVital(item.temperatura, '°C')} · {formatVital(item.pulso, 'lpm')}
      </Text>
      <StatusPill>{syncLabel}</StatusPill>
    </Pressable>
  );
}

export function VitalsDataScreen() {
  const { repository } = useLocalData();
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const styles = useStyles();
  const load = useCallback(
    (offset: number) =>
      repository ? repository.vitals(sinceDays(days), 30, offset) : Promise.resolve([]),
    [repository, days],
  );
  const list = useFocusedList(load);
  return (
    <Screen isRoot title="Historial de signos vitales" scroll={false}>
      <FlatList
        data={list.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RecordCard item={item} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.stack}>
            <View style={styles.chips}>
              {([7, 30, 90] as const).map((period) => (
                <ChoiceChip
                  key={period}
                  label={`${period} días`}
                  selected={days === period}
                  onPress={() => setDays(period)}
                />
              ))}
            </View>
            <BodyText>Las mediciones se guardan en este dispositivo.</BodyText>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={list.error ? 'alert-circle' : list.loading ? 'clock' : 'activity'}
            title={
              list.error
                ? 'No se pudo leer el historial'
                : list.loading
                  ? 'Cargando registros'
                  : 'Todavía no hay registros'
            }
            description={
              list.error
                ? 'Reintenta la consulta local.'
                : 'Las mediciones aparecerán aquí después de guardarlas.'
            }
          />
        }
        ListFooterComponent={
          <View style={styles.stack}>
            {list.error ? (
              <VisualButton label="Reintentar" secondary onPress={list.refresh} />
            ) : null}
            {list.hasMore ? (
              <VisualButton
                label={list.loadingMore ? 'Cargando…' : 'Cargar más'}
                secondary
                disabled={list.loadingMore}
                onPress={() => void list.loadMore()}
              />
            ) : null}
            <VisualButton
              label="Registrar signos vitales"
              disabled={!repository}
              onPress={() => router.navigate('/vitales/registrar')}
            />
            <VisualButton
              label="Ver reportes"
              secondary
              onPress={() => router.navigate('/vitales/reportes')}
            />
          </View>
        }
      />
    </Screen>
  );
}

export function RegisterVitalsDataScreen() {
  const { repository, runSave, saving } = useLocalData();
  const [values, setValues] = useState<VitalInput>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || saving;
  async function save() {
    if (busy || !repository) return;
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const parsed = parseVitalInput(values);
      await runSave(() => repository.createVitals(parsed));
      setValues(initialValues);
      setSaved(true);
    } catch (failure) {
      setError(
        failure instanceof InputError
          ? failure.message
          : 'No se pudo guardar en este dispositivo. Intenta nuevamente.',
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Screen title="Registrar signos vitales">
      <BodyText>Registra tus mediciones de prueba. No se realiza evaluación clínica.</BodyText>
      <VisualField
        label="Temperatura corporal (°C)"
        value={values.temperature}
        onChangeText={(temperature) => setValues({ ...values, temperature })}
        keyboardType="numeric"
        placeholder="Ej.: 36,8"
      />
      <SectionTitle>Presión arterial</SectionTitle>
      <VisualField
        label="Sistólica (mmHg)"
        value={values.systolic}
        onChangeText={(systolic) => setValues({ ...values, systolic })}
        keyboardType="numeric"
      />
      <VisualField
        label="Diastólica (mmHg)"
        value={values.diastolic}
        onChangeText={(diastolic) => setValues({ ...values, diastolic })}
        keyboardType="numeric"
      />
      <VisualField
        label="Pulso (lpm)"
        value={values.pulse}
        onChangeText={(pulse) => setValues({ ...values, pulse })}
        keyboardType="numeric"
      />
      <VisualField
        label="Saturación (%)"
        value={values.saturation}
        onChangeText={(saturation) => setValues({ ...values, saturation })}
        keyboardType="numeric"
      />
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {saved ? <StatusPill>{pendingLabel}</StatusPill> : null}
      <VisualButton
        label={busy ? 'Guardando…' : 'Guardar registro'}
        disabled={busy || !repository}
        onPress={() => void save()}
      />
      <VisualButton
        label="Ver historial de mediciones"
        secondary
        onPress={() => router.navigate('/vitales')}
      />
    </Screen>
  );
}

export function VitalDataDetailScreen() {
  const { repository } = useLocalData();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const load = useCallback(
    () => (repository && id ? repository.vital(id) : Promise.resolve(null)),
    [repository, id],
  );
  const {
    value: record,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, null as VitalWithSyncRecord | null);
  return (
    <Screen title="Detalle del registro">
      {loading ? (
        <BodyText>Cargando registro…</BodyText>
      ) : error ? (
        <>
          <BodyText>No se pudo leer el registro local.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </>
      ) : !record ? (
        <EmptyState
          icon="alert-circle"
          title="Registro no encontrado"
          description="No existe un registro con este ID para el paciente seleccionado."
        />
      ) : (
        <>
          <InfoCard>
            <SectionTitle>{formatDate(record.fecha_registro)}</SectionTitle>
            <DetailRow label="Temperatura" value={formatVital(record.temperatura, '°C')} />
            <DetailRow
              label="Presión arterial"
              value={
                record.presion_sistolica === null
                  ? 'Sin registro'
                  : `${record.presion_sistolica}/${record.presion_diastolica} mmHg`
              }
            />
            <DetailRow label="Pulso" value={formatVital(record.pulso, 'lpm')} />
            <DetailRow label="Saturación" value={formatVital(record.saturacion_o2, '%')} />
          </InfoCard>
          <StatusPill>
            {record.estado_envio === 'pendiente' || !record.estado_envio
              ? pendingLabel
              : `Estado de sincronización: ${record.estado_envio}`}
          </StatusPill>
          <BodyText>El registro no se ha enviado ni evaluado clínicamente.</BodyText>
        </>
      )}
    </Screen>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  return StyleSheet.create({
    list: { flexGrow: 1, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
    stack: { gap: theme.spacing.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    record: {
      minHeight: 100,
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: appTheme.colors.surface,
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recordTitle: { fontSize: 17, fontWeight: '700', color: appTheme.colors.text },
    small: { fontSize: 14, color: appTheme.colors.secondary },
  });
}
