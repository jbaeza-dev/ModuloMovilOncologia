import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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
import { theme } from '../../theme';

export function ReportsScreen() {
  const [period, setPeriod] = useState('30 días');
  const [format, setFormat] = useState('PDF');
  return (
    <Screen title="Reportes" backTo="/vitales">
      <DemoBadge />
      <BodyText>Previsualización del flujo de exportación. No se crean archivos.</BodyText>
      <SectionTitle>Período</SectionTitle>
      <View style={styles.chips}>
        {['7 días', '30 días', '90 días'].map((item) => (
          <ChoiceChip
            key={item}
            label={item}
            selected={period === item}
            onPress={() => setPeriod(item)}
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
        <SectionTitle>Resumen de ejemplo</SectionTitle>
        <DetailRow label="Período" value={period} />
        <DetailRow label="Formato" value={format} />
        <DetailRow label="Registros" value="4 ficticios" />
      </InfoCard>
      <VisualButton label="Generar reporte · disponible más adelante" />
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
