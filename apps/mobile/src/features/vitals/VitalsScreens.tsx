import { AppIcon as Feather } from '../../components/AppIcon';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  ChoiceChip,
  DemoBadge,
  DetailRow,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { vitalRecords } from '../preview/fixtures';

type RecordItem = (typeof vitalRecords)[number];

function RecordCard({ item }: { item: RecordItem }) {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'Ver registro del ' + item.date}
      onPress={() => router.push('/vitales/demo-detalle')}
      style={styles.record}
    >
      <View style={styles.row}>
        <Text style={styles.recordTitle}>{item.date}</Text>
        <Feather name="chevron-right" size={20} color={appTheme.colors.text} />
      </View>
      <Text style={styles.small}>
        {item.temperature} · {item.pressure} · {item.pulse}
      </Text>
      <StatusPill>Dato ficticio</StatusPill>
    </Pressable>
  );
}

export function VitalsScreen() {
  const styles = useStyles();
  const [days, setDays] = useState(7);
  const { vista } = useLocalSearchParams<{ vista?: string }>();
  const state = [
    'vacia',
    'cargando',
    'error',
    'sin-conexion',
    'pendiente',
    'sincronizando',
    'sincronizado',
  ].includes(vista ?? '')
    ? vista
    : 'lista';
  const data =
    state === 'lista' ||
    state === 'pendiente' ||
    state === 'sincronizando' ||
    state === 'sincronizado'
      ? vitalRecords.filter((item) => item.period <= days)
      : [];
  return (
    <Screen title="Historial de signos vitales" scroll={false}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RecordCard item={item} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.stack}>
            <DemoBadge />
            <View style={styles.chips}>
              {[7, 30, 90].map((period) => (
                <ChoiceChip
                  key={period}
                  label={String(period) + ' días'}
                  selected={days === period}
                  onPress={() => setDays(period)}
                />
              ))}
            </View>
            {state === 'pendiente' || state === 'sincronizando' || state === 'sincronizado' ? (
              <StatusPill>
                {state === 'pendiente'
                  ? 'Pendiente de sincronización · ejemplo'
                  : state === 'sincronizando'
                    ? 'Sincronizando · ejemplo'
                    : 'Sincronizado · ejemplo'}
              </StatusPill>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          state === 'vacia' ? (
            <EmptyState
              icon="activity"
              title="Todavía no hay registros"
              description="Aquí aparecerían tus mediciones."
            />
          ) : state === 'cargando' ? (
            <EmptyState
              icon="clock"
              title="Cargando registros"
              description="Estado de carga de ejemplo."
            />
          ) : state === 'sin-conexion' ? (
            <EmptyState
              icon="wifi-off"
              title="Sin conexión"
              description="Estado visual; no se está comprobando la conexión."
            />
          ) : (
            <EmptyState
              icon="alert-circle"
              title="No se pudieron mostrar los registros"
              description="Estado de error de ejemplo."
            />
          )
        }
        ListFooterComponent={
          <View style={styles.stack}>
            <VisualButton
              label="Registrar signos vitales"
              onPress={() => router.push('/vitales/registrar')}
            />
            <VisualButton
              label="Ver reportes"
              secondary
              onPress={() => router.push('/vitales/reportes')}
            />
          </View>
        }
      />
    </Screen>
  );
}

export function RegisterVitalsScreen() {
  const [values, setValues] = useState({
    temperature: '',
    systolic: '',
    diastolic: '',
    pulse: '',
    saturation: '',
  });
  return (
    <Screen title="Registrar signos vitales">
      <DemoBadge />
      <BodyText>
        Los campos permiten revisar el diseño. Ninguna medición se guarda ni se evalúa.
      </BodyText>
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
      <VisualButton label="Guardar registro · disponible más adelante" />
    </Screen>
  );
}

export function VitalDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const record = vitalRecords.find((item) => item.id === id) ?? vitalRecords[0];
  return (
    <Screen title="Detalle del registro">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>{record.date}</SectionTitle>
        <DetailRow label="Temperatura" value={record.temperature} />
        <DetailRow label="Presión arterial" value={record.pressure} />
        <DetailRow label="Pulso" value={record.pulse} />
        <DetailRow label="Saturación" value={record.saturation} />
      </InfoCard>
      <StatusPill>Sincronizado · ejemplo visual</StatusPill>
      <BodyText>
        Los valores son ficticios; este detalle no muestra una evaluación clínica.
      </BodyText>
    </Screen>
  );
}

type ResultKind = 'guardado' | 'normal' | 'atencion' | 'prioritaria';

const resultCopy: Record<
  ResultKind,
  { title: string; text: string; icon: 'check-circle' | 'info' | 'alert-circle' }
> = {
  guardado: {
    title: 'Registro guardado',
    text: 'Presentación de una confirmación futura. No se ha guardado información.',
    icon: 'check-circle',
  },
  normal: {
    title: 'Evaluación sin alertas',
    text: 'Vista de demostración. No se han evaluado signos vitales.',
    icon: 'check-circle',
  },
  atencion: {
    title: 'Atención',
    text: 'Vista de demostración de un estado que deberá definir el equipo clínico.',
    icon: 'info',
  },
  prioritaria: {
    title: 'Atención prioritaria',
    text: 'Vista de demostración. Su contenido final requiere reglas clínicas aprobadas.',
    icon: 'alert-circle',
  },
};

export function VitalResultScreen({ kind }: { kind: ResultKind }) {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const copy = resultCopy[kind];
  return (
    <Screen>
      <DemoBadge />
      <View style={styles.result}>
        <Feather name={copy.icon} size={64} color={appTheme.colors.primary} />
        <Text accessibilityRole="header" style={styles.resultTitle}>
          {copy.title}
        </Text>
        <BodyText>{copy.text}</BodyText>
      </View>
      <InfoCard>
        <SectionTitle>Resumen de ejemplo</SectionTitle>
        <DetailRow label="Temperatura" value="36,8 °C" />
        <DetailRow label="Pulso" value="72 lpm" />
      </InfoCard>
      <VisualButton label="Volver a Vitales" onPress={() => router.replace('/vitales')} />
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
    result: { alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.lg },
    resultTitle: {
      fontSize: 25,
      fontWeight: '700',
      color: appTheme.colors.text,
      textAlign: 'center',
    },
  });
}
