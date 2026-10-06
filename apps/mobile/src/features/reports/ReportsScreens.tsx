import { File } from 'expo-file-system';
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
import { formatDate, sinceDays, type VitalsSummary } from '../../data/local/repository';
import {
  assertSafeReportFileName,
  getPatientReportDirectory,
  parseTimestampFromReportFilename,
  shareReportPdf,
} from '../../data/local/report-storage';
import { useFocusedValue } from '../../data/local/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { generateAndPersistReportPdf } from './report-pdf';

export function ReportsScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const [days, setDays] = useState<7 | 30 | 90>(30);
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
      const { persistentUri, filename } = await generateAndPersistReportPdf({
        pacienteId: patientId,
        periodDays: days,
        profile,
        treatment,
        summary,
        vitals,
      });

      const shareResult = await shareReportPdf(persistentUri);
      if (shareResult === 'shared_sheet_opened') {
        setReportFeedback('PDF guardado en el dispositivo y hoja de compartir abierta.');
      } else {
        setReportFeedback(
          'PDF guardado en el dispositivo (no se pudo abrir la hoja de compartir).',
        );
      }

      router.navigate('/vitales/reporte-estado?archivo=' + encodeURIComponent(filename));
    } catch {
      setReportError('No se pudo generar el reporte PDF en este dispositivo.');
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

      <SectionTitle>Formato disponible</SectionTitle>
      <View style={styles.chips}>
        <ChoiceChip label="PDF (Documento descargable)" selected onPress={() => {}} />
      </View>
      <BodyText>
        Solo formato PDF soportado localmente en esta versión. Excel no está habilitado en la
        demostración independiente.
      </BodyText>

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
            <DetailRow label="Formato" value="PDF" />
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

          {summary.total === 0 ? (
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
  const { patientId } = useLocalData();
  const { archivo } = useLocalSearchParams<{ archivo?: string }>();
  const [sharingFeedback, setSharingFeedback] = useState<string | null>(null);

  let isValidFormat = false;
  try {
    if (archivo) {
      assertSafeReportFileName(archivo);
      isValidFormat = true;
    }
  } catch {
    isValidFormat = false;
  }

  // Reconstrucción estricta dentro del directorio del paciente activo
  const patientDir = patientId ? getPatientReportDirectory(patientId) : null;
  const targetFile = patientDir && isValidFormat && archivo ? new File(patientDir, archivo) : null;
  const fileExists = targetFile ? targetFile.exists : false;

  async function handleReshare() {
    if (!targetFile || !fileExists) return;
    setSharingFeedback(null);
    const result = await shareReportPdf(targetFile.uri);
    if (result === 'shared_sheet_opened') {
      setSharingFeedback('Hoja de compartir del sistema abierta.');
    } else {
      setSharingFeedback(
        'No se pudo abrir la hoja de compartir. El PDF permanece guardado en el dispositivo.',
      );
    }
  }

  if (!isValidFormat || !fileExists || !targetFile || !archivo) {
    return (
      <Screen title="Estado del reporte" backTo="/vitales/reportes">
        <DemoBadge />
        <EmptyState
          icon="alert-circle"
          title="Reporte no encontrado"
          description="El documento solicitado no existe o no pertenece al paciente activo."
        />
        <VisualButton
          label="Volver a Reportes"
          secondary
          onPress={() => router.replace('/vitales/reportes')}
        />
      </Screen>
    );
  }

  const sizeKb = targetFile.size ? (targetFile.size / 1024).toFixed(1) : null;
  const timestampIso =
    targetFile.creationTime != null
      ? new Date(targetFile.creationTime).toISOString()
      : targetFile.modificationTime != null
        ? new Date(targetFile.modificationTime).toISOString()
        : parseTimestampFromReportFilename(archivo);
  const formattedDate = timestampIso ? formatDate(timestampIso) : 'Reciente';

  return (
    <Screen title="Estado del reporte" backTo="/vitales/reportes">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Reporte generado y guardado</SectionTitle>
        <StatusPill>Persistido en almacenamiento local</StatusPill>
        <DetailRow label="Archivo" value={archivo} />
        <DetailRow label="Tamaño" value={sizeKb ? `${sizeKb} KB` : 'No disponible'} />
        <DetailRow label="Generado el" value={formattedDate} />
        {sharingFeedback ? <StatusPill>{sharingFeedback}</StatusPill> : null}
      </InfoCard>

      <VisualButton label="Abrir hoja de compartir" onPress={handleReshare} />
      <VisualButton
        label="Generar otro reporte"
        secondary
        onPress={() => router.replace('/vitales/reportes')}
      />
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    errorText: {
      fontSize: 14,
      color: colors.error,
      marginTop: theme.spacing.xs,
    },
  });
}
