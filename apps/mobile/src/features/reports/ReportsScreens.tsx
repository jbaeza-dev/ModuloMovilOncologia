import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
import { shareReportPdf } from '../../data/local/report-storage';
import { useFocusedValue } from '../../data/local/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { generateAndPersistReportPdf } from './report-pdf';

export function ReportsScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [format, setFormat] = useState('PDF');
  const [generating, setGenerating] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const { repository, patientId } = useLocalData();

  const load = useCallback(
    () =>
      repository
        ? repository.vitalsSummary(sinceDays(days))
        : Promise.resolve({ total: 0, avgTemperature: null, avgPulse: null }),
    [repository, days],
  );
  const {
    value: summary,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, {
    total: 0,
    avgTemperature: null,
    avgPulse: null,
  } as VitalsSummary);

  async function handleSharePdf() {
    if (!repository || !patientId || generating) return;
    setGenerating(true);
    setReportFeedback(null);
    setReportError(null);
    try {
      const profile = await repository.profile();
      const treatment = await repository.treatment();
      const vitals = await repository.vitalsForReport(sinceDays(days));
      const persistentUri = await generateAndPersistReportPdf({
        pacienteId: patientId,
        periodDays: days,
        profile,
        treatment,
        summary,
        vitals,
      });
      setReportFeedback('Reporte guardado en almacenamiento persistente del dispositivo.');
      await shareReportPdf(persistentUri);
    } catch {
      setReportError('No se pudo generar ni compartir el reporte PDF en este dispositivo.');
    } finally {
      setGenerating(false);
    }
  }

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
            onPress={() => {
              setDays(item);
              setReportFeedback(null);
              setReportError(null);
            }}
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
            onPress={() => {
              setFormat(item);
              setReportFeedback(null);
              setReportError(null);
            }}
          />
        ))}
      </View>

      {format === 'Excel' ? (
        <InfoCard>
          <Text style={styles.noticeText}>
            Formato no disponible en demostración local. Selecciona PDF para generar y compartir el
            documento.
          </Text>
        </InfoCard>
      ) : null}

      {error ? (
        <>
          <EmptyState
            icon="alert-circle"
            title="Error al consultar mediciones"
            description="No se pudieron cargar los datos de evolución clínica en este dispositivo."
          />
          <VisualButton label="Reintentar" secondary onPress={refresh} />
        </>
      ) : (
        <>
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
            {reportFeedback ? <StatusPill>{reportFeedback}</StatusPill> : null}
            {reportError ? <Text style={styles.errorText}>{reportError}</Text> : null}
          </InfoCard>

          {!loading && summary.total === 0 ? (
            <BodyText>
              No hay mediciones registradas para este paciente en los últimos {days} días.
            </BodyText>
          ) : null}

          {format === 'Excel' ? (
            <VisualButton label="Formato Excel no disponible" disabled onPress={() => {}} />
          ) : summary.total === 0 ? (
            <VisualButton
              label="Registrar signos vitales"
              disabled={loading}
              onPress={() => router.navigate('/vitales/registrar')}
            />
          ) : (
            <VisualButton
              label={generating ? 'Generando PDF…' : 'Compartir PDF'}
              disabled={loading || generating}
              onPress={handleSharePdf}
            />
          )}
        </>
      )}
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
          description="Generación local de reporte en curso."
        />
      ) : state === 'disponible' ? (
        <InfoCard>
          <SectionTitle>Reporte disponible</SectionTitle>
          <StatusPill>Persistido en dispositivo</StatusPill>
          <BodyText>
            El documento PDF fue guardado de manera persistente en el dispositivo y puede ser
            compartido.
          </BodyText>
        </InfoCard>
      ) : (
        <EmptyState
          icon="alert-circle"
          title="No se pudo generar"
          description="Ocurrió un inconveniente al generar o compartir el archivo local."
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

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    noticeText: {
      fontSize: 14,
      color: colors.secondary,
      lineHeight: 20,
    },
    errorText: {
      fontSize: 14,
      color: colors.error,
      marginTop: theme.spacing.xs,
    },
  });
}
