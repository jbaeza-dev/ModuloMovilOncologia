import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  ChoiceChip,
  DetailRow,
  EmptyState,
  FeedbackBanner,
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
import { validateVitalInput, type VitalInput } from '../../data/local/validation';
import { useFocusedList, useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { clearHomeScrollToTop } from '../home/home-scroll-signal';
import {
  formatRecordTime,
  formatVitalCardAccessibilityLabel,
  formatVitalsSummary,
  getSyncStatusLabel,
  groupVitalsByDay,
} from './vitals-formatters';

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
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const syncLabel = getSyncStatusLabel(item);
  const time = formatRecordTime(item.fecha_registro);
  const summary = formatVitalsSummary(item);
  const accessibilityLabel = formatVitalCardAccessibilityLabel(item, nowIso);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => router.navigate({ pathname: '/vitales/detalle', params: { id: item.id } })}
      style={styles.record}
    >
      <View style={styles.row}>
        <Text style={styles.recordTitle}>{time}</Text>
        <Feather name="chevron-right" size={20} color={appTheme.colors.text} />
      </View>
      <Text style={styles.summaryText}>{summary}</Text>
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

  const sections = useMemo(
    () => groupVitalsByDay(list.items, new Date().toISOString()),
    [list.items],
  );

  return (
    <Screen isRoot title="Historial de signos vitales" scroll={false}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RecordCard item={item} />}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeaderContainer}>
            <Text accessibilityRole="header" style={styles.sectionHeaderTitle}>
              {title}
            </Text>
          </View>
        )}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.stack}>
            <View style={styles.headerButtons}>
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
          </View>
        }
      />
    </Screen>
  );
}

export function RegisterVitalsDataScreen() {
  const { repository, runSave, saving, isClosing } = useLocalData();
  const navigation = useNavigation();
  const [values, setValues] = useState<VitalInput>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof VitalInput, string>>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [savedRecord, setSavedRecord] = useState<{ id: string; summary: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const bypassPreventRemoveRef = useRef(false);

  const tempRef = useRef<TextInput>(null);
  const sysRef = useRef<TextInput>(null);
  const diaRef = useRef<TextInput>(null);
  const pulseRef = useRef<TextInput>(null);
  const satRef = useRef<TextInput>(null);

  const styles = useStyles();
  const busy = submitting || saving;

  const isDirty =
    values.temperature.trim().length > 0 ||
    values.systolic.trim().length > 0 ||
    values.diastolic.trim().length > 0 ||
    values.pulse.trim().length > 0 ||
    values.saturation.trim().length > 0;

  const shouldPreventRemove = isDirty && !isClosing && !bypassPreventRemoveRef.current;

  usePreventRemove(shouldPreventRemove, ({ data }) => {
    Alert.alert(
      '¿Descartar cambios?',
      'Tienes datos ingresados sin guardar en este formulario.',
      [
        {
          text: 'Seguir editando',
          style: 'cancel',
          onPress: () => {
            clearHomeScrollToTop();
          },
        },
        {
          text: 'Salir sin guardar',
          style: 'destructive',
          onPress: () => {
            bypassPreventRemoveRef.current = true;
            if (data?.action && typeof navigation?.dispatch === 'function') {
              navigation.dispatch(data.action);
            } else {
              router.back();
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          clearHomeScrollToTop();
        },
      },
    );
  });

  const handleChange = (field: keyof VitalInput, text: string) => {
    setValues((prev) => ({ ...prev, [field]: text }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (generalError) {
      setGeneralError(null);
    }
  };

  async function save() {
    if (busy || !repository) return;
    setGeneralError(null);

    const validation = validateVitalInput(values);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      setGeneralError(validation.generalError ?? null);

      if (validation.errors.temperature) tempRef.current?.focus();
      else if (validation.errors.systolic) sysRef.current?.focus();
      else if (validation.errors.diastolic) diaRef.current?.focus();
      else if (validation.errors.pulse) pulseRef.current?.focus();
      else if (validation.errors.saturation) satRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const createdId = await runSave(() => repository.createVitals(validation.values));
      const summary = formatVitalsSummary(validation.values);
      setSavedRecord({ id: createdId, summary });
      setValues(initialValues);
      setFieldErrors({});
      setGeneralError(null);
    } catch {
      setGeneralError('No se pudo guardar en este dispositivo. Intenta nuevamente.');
    } finally {
      setSubmitting(false);
    }
  }

  const bottomAction = (
    <View style={styles.bottomActionStack}>
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
    </View>
  );

  return (
    <Screen title="Registrar signos vitales" bottomAction={bottomAction}>
      <BodyText>
        Guarda las mediciones que tengas disponibles. Puedes dejar las demás en blanco. No se
        realiza evaluación clínica.
      </BodyText>

      {savedRecord ? (
        <FeedbackBanner
          variant="success"
          title="Medición guardada en este dispositivo"
          message={savedRecord.summary}
          actionLabel="Ver registro"
          onAction={() =>
            router.navigate({ pathname: '/vitales/detalle', params: { id: savedRecord.id } })
          }
        />
      ) : null}

      <VisualField
        label="Temperatura corporal (°C)"
        value={values.temperature}
        onChangeText={(t) => handleChange('temperature', t)}
        keyboardType="decimal-pad"
        placeholder="Ej.: 36,8"
        helperText="Ejemplo de formato: 36,8"
        errorText={fieldErrors.temperature}
        inputRef={tempRef}
        returnKeyType="next"
        onSubmitEditing={() => sysRef.current?.focus()}
        editableValueStyle
      />

      <SectionTitle>Presión arterial</SectionTitle>
      <VisualField
        label="Presión sistólica (mmHg)"
        value={values.systolic}
        onChangeText={(s) => handleChange('systolic', s)}
        keyboardType="number-pad"
        helperText="Valor superior del tensiómetro"
        errorText={fieldErrors.systolic}
        inputRef={sysRef}
        returnKeyType="next"
        onSubmitEditing={() => diaRef.current?.focus()}
        editableValueStyle
      />
      <VisualField
        label="Presión diastólica (mmHg)"
        value={values.diastolic}
        onChangeText={(d) => handleChange('diastolic', d)}
        keyboardType="number-pad"
        helperText="Valor inferior del tensiómetro"
        errorText={fieldErrors.diastolic}
        inputRef={diaRef}
        returnKeyType="next"
        onSubmitEditing={() => pulseRef.current?.focus()}
        editableValueStyle
      />

      <VisualField
        label="Pulso"
        value={values.pulse}
        onChangeText={(p) => handleChange('pulse', p)}
        keyboardType="number-pad"
        helperText="Latidos por minuto"
        errorText={fieldErrors.pulse}
        inputRef={pulseRef}
        returnKeyType="next"
        onSubmitEditing={() => satRef.current?.focus()}
        editableValueStyle
      />

      <VisualField
        label="Saturación de oxígeno (%)"
        value={values.saturation}
        onChangeText={(s) => handleChange('saturation', s)}
        keyboardType="number-pad"
        errorText={fieldErrors.saturation}
        inputRef={satRef}
        returnKeyType="done"
        editableValueStyle
      />

      {generalError ? (
        <Text accessibilityRole="alert" style={styles.generalError}>
          {generalError}
        </Text>
      ) : null}
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

  const syncLabel = record ? getSyncStatusLabel(record) : 'Guardado en este dispositivo';

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
                record.presion_sistolica !== null && record.presion_diastolica !== null
                  ? `${record.presion_sistolica}/${record.presion_diastolica} mmHg`
                  : record.presion_sistolica !== null
                    ? `Sistólica: ${record.presion_sistolica} mmHg`
                    : record.presion_diastolica !== null
                      ? `Diastólica: ${record.presion_diastolica} mmHg`
                      : 'Sin registro'
              }
            />
            <DetailRow label="Pulso" value={formatVital(record.pulso, 'lpm')} />
            <DetailRow label="Saturación" value={formatVital(record.saturacion_o2, '%')} />
          </InfoCard>
          <StatusPill>{syncLabel}</StatusPill>
          <BodyText>
            El estado de envío indica la confirmación del servidor. El registro no implica
            evaluación clínica.
          </BodyText>
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
    headerButtons: { gap: theme.spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    sectionHeaderContainer: {
      paddingVertical: theme.spacing.xs,
      backgroundColor: appTheme.colors.background,
    },
    sectionHeaderTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: appTheme.colors.text,
    },
    record: {
      minHeight: 100,
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: appTheme.colors.surface,
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recordTitle: { fontSize: 17, fontWeight: '700', color: appTheme.colors.text },
    summaryText: { fontSize: 14, color: appTheme.colors.secondary, lineHeight: 20 },
    bottomActionStack: { gap: theme.spacing.sm },
    generalError: { fontSize: 14, color: appTheme.colors.error, fontWeight: '600' },
  });
}
