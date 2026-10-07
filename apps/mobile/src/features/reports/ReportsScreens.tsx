import Feather from '@expo/vector-icons/Feather';
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
  deletePatientReport,
  getPatientReportDirectory,
  getPatientReportList,
  parseTimestampFromReportFilename,
  shareReportPdf,
  type PatientReportItem,
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

  const loadExistingReports = useCallback(async () => {
    if (!patientId) return [];
    return getPatientReportList(patientId);
  }, [patientId]);

  const {
    value: savedReports,
    loading: loadingReports,
    refresh: refreshReports,
  } = useFocusedValue(loadExistingReports, [] as PatientReportItem[]);

  const existingForPeriod = savedReports.find((r) => r.periodDays === days);

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

      refreshReports();

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

  async function handleDeleteReport(filename: string) {
    if (!patientId) return;
    setReportFeedback(null);
    setReportError(null);
    try {
      const ok = await deletePatientReport(patientId, filename);
      if (ok) {
        setReportFeedback('Reporte eliminado del almacenamiento local.');
      } else {
        setReportError('No se pudo encontrar el archivo del reporte para eliminarlo.');
      }
      refreshReports();
    } catch {
      setReportError('Error al eliminar el reporte del dispositivo.');
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
            {existingForPeriod ? (
              <BodyText>
                Ya existe un reporte guardado para los últimos {days} días (
                {existingForPeriod.generatedAt
                  ? formatDate(existingForPeriod.generatedAt)
                  : 'reciente'}
                ). Al generar uno nuevo se reemplazará para evitar archivos duplicados.
              </BodyText>
            ) : null}
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
              label={
                generating
                  ? 'Generando PDF…'
                  : existingForPeriod
                    ? 'Actualizar y compartir PDF'
                    : 'Compartir PDF'
              }
              disabled={loading || generating}
              onPress={handleSharePdf}
            />
          )}
        </>
      )}

      <SectionTitle>Reportes guardados en el dispositivo</SectionTitle>
      {loadingReports ? (
        <BodyText>Cargando reportes guardados…</BodyText>
      ) : savedReports.length === 0 ? (
        <InfoCard>
          <BodyText>No hay reportes PDF generados previamente en este dispositivo.</BodyText>
        </InfoCard>
      ) : (
        savedReports.map((report) => {
          const sizeKb = report.sizeBytes ? (report.sizeBytes / 1024).toFixed(1) : null;
          const formattedDate = report.generatedAt ? formatDate(report.generatedAt) : 'Reciente';

          return (
            <InfoCard key={report.filename}>
              <View style={styles.cardHeader}>
                <Feather name="file-text" size={24} color={appTheme.colors.primary} />
                <View style={styles.cardHeaderCopy}>
                  <Text style={styles.cardTitle}>
                    {report.periodDays
                      ? `Reporte de evolución (${report.periodDays} días)`
                      : 'Reporte clínico'}
                  </Text>
                  <BodyText>Generado el {formattedDate}</BodyText>
                </View>
              </View>

              <DetailRow label="Archivo" value={report.filename} />
              <DetailRow label="Tamaño" value={sizeKb ? `${sizeKb} KB` : 'No disponible'} />
              <StatusPill>Almacenamiento local</StatusPill>

              <View style={styles.reportActions}>
                <VisualButton
                  label="Ver o compartir"
                  onPress={() =>
                    router.navigate(
                      '/vitales/reporte-estado?archivo=' + encodeURIComponent(report.filename),
                    )
                  }
                />
                <VisualButton
                  label="Eliminar reporte"
                  secondary
                  onPress={() => handleDeleteReport(report.filename)}
                />
              </View>
            </InfoCard>
          );
        })
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
        label="Volver a reportes guardados"
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
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.xs,
    },
    cardHeaderCopy: { flex: 1, gap: 2 },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    reportActions: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  });
}
