import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
} from '../../components/Visual';
import { sinceDays, type VitalsSummary } from '../../data/local/repository';
import { useFocusedValue } from '../../data/local/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { theme } from '../../theme';

export function ReportsScreen() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [format, setFormat] = useState('PDF');
  const { repository } = useLocalData();

  const load = useCallback(
    () =>
      repository
        ? repository.vitalsSummary(sinceDays(days))
        : Promise.resolve({ total: 0, avgTemperature: null, avgPulse: null }),
    [repository, days],
  );
  const { value: summary, loading } = useFocusedValue(load, {
    total: 0,
    avgTemperature: null,
    avgPulse: null,
  } as VitalsSummary);

  return (
    <Screen title="Reportes" backTo="/vitales">
      <BodyText>
        Resumen de evolución clínica generado a partir de registros en este dispositivo.
      </BodyText>
      <SectionTitle>Período</SectionTitle>
      <View style={styles.chips}>
        {([7, 30, 90] as const).map((item) => (
          <ChoiceChip
            key={item}
            label={`${item} días`}
            selected={days === item}
            onPress={() => setDays(item)}
          />
        ))}
      </View>
      <SectionTitle>Formato</SectionTitle>
      <View style={styles.chips}>
        {['PDF', 'Excel'].map((item) => (
          <ChoiceChip
            key={item}
            label={item}
            selected={format === item}
            onPress={() => setFormat(item)}
          />
        ))}
      </View>
      <InfoCard>
        <SectionTitle>Resumen de mediciones</SectionTitle>
        <DetailRow label="Período" value={`${days} días`} />
        <DetailRow label="Formato" value={format} />
        <DetailRow
          label="Registros guardados"
          value={
            loading
              ? 'Calculando…'
              : `${summary.total} ${summary.total === 1 ? 'registro' : 'registros'}`
          }
        />
        {summary.avgTemperature !== null ? (
          <DetailRow
            label="Temperatura prom."
            value={`${summary.avgTemperature.toLocaleString('es-CL')} °C`}
          />
        ) : null}
        {summary.avgPulse !== null ? (
          <DetailRow
            label="Pulso prom."
            value={`${summary.avgPulse.toLocaleString('es-CL')} lpm`}
          />
        ) : null}
        <StatusPill>Almacenamiento local</StatusPill>
      </InfoCard>

      {summary.total === 0 ? (
        <BodyText>
          No hay mediciones registradas para este paciente en los últimos {days} días.
        </BodyText>
      ) : null}

      <VisualButton
        label={summary.total > 0 ? 'Previsualizar estado del reporte' : 'Registrar signos vitales'}
        onPress={() => {
          if (summary.total > 0) {
            router.navigate('/vitales/reporte-estado?estado=disponible');
          } else {
            router.navigate('/vitales/registrar');
          }
        }}
      />
    </Screen>
  );
}

export function ReportStatusScreen() {
  const { estado } = useLocalSearchParams<{ estado?: string }>();
  const state =
    estado === 'preparando' || estado === 'disponible' || estado === 'error'
      ? estado
      : 'preparando';
  return (
    <Screen title="Estado del reporte" backTo="/vitales/reportes">
      <DemoBadge />
      {state === 'preparando' ? (
        <EmptyState
          icon="clock"
          title="Preparando reporte"
          description="Estado de presentación. No hay generación en curso."
        />
      ) : state === 'disponible' ? (
        <InfoCard>
          <SectionTitle>Reporte disponible</SectionTitle>
          <StatusPill>Ejemplo visual</StatusPill>
          <BodyText>
            En la versión funcional se podrá abrir o compartir el archivo generado.
          </BodyText>
        </InfoCard>
      ) : (
        <EmptyState
          icon="alert-circle"
          title="No se pudo generar"
          description="Estado de error de ejemplo. No se intentó crear ningún archivo."
        />
      )}
      <VisualButton
        label="Volver a Reportes"
        secondary
        onPress={() => router.replace('/vitales/reportes')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
});
