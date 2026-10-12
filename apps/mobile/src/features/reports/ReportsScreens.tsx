import Feather from '@expo/vector-icons/Feather';
import { File } from 'expo-file-system';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  assertSafeReportFileName,
  deletePatientReport,
  getPatientReportDirectory,
  getPatientReportList,
  parseFormatFromReportFilename,
  parseTimestampFromReportFilename,
  shareReportFile,
  type PatientReportItem,
  type ReportFileFormat,
} from '../../data/local/files/report-storage';
import type { ReportData } from '../../data/local/reports/report-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { generateAndPersistReportPdf } from './report-pdf';
import { generateAndPersistReportXlsx } from './report-xlsx';

export function ReportsScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [selectedFormat, setSelectedFormat] = useState<ReportFileFormat>('pdf');
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const isFocusedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => {
        isFocusedRef.current = false;
      };
    }, []),
  );

  const { repository, patientId, runSave, saving } = useLocalData();

  const loadData = useCallback(async () => {
    if (!repository) return null;
    return repository.reports.getReportData(days);
  }, [repository, days]);

  const {
    value: reportData,
    loading: loadingData,
    error,
    refresh: refreshData,
  } = useFocusedValue(loadData, null as ReportData | null);

  const loadExistingReports = useCallback(async () => {
    if (!patientId) return [];
    return getPatientReportList(patientId);
  }, [patientId]);

  const {
    value: savedReports,
    loading: loadingReports,
    error: errorReports,
    refresh: refreshReports,
  } = useFocusedValue(loadExistingReports, [] as PatientReportItem[]);

  const existingForPeriodAndFormat = savedReports.find(
    (r) => r.periodDays === days && r.format === selectedFormat,
  );

  const hasClinicalData =
    reportData && (reportData.summary.vitalsCount > 0 || reportData.summary.symptomsCount > 0);

  async function handleGenerateAndShare() {
    if (!repository || !patientId || saving || !reportData || !hasClinicalData) return;
    const targetDays = days;
    const targetFormat = selectedFormat;

    setReportFeedback(null);
    setReportError(null);

    try {
      await runSave(async () => {
        // Capturar una instantánea fresca al momento de confirmar
        const freshData = await repository.reports.getReportData(targetDays);
        if (freshData.summary.vitalsCount === 0 && freshData.summary.symptomsCount === 0) {
          throw new Error('No hay registros clínicos en el período para generar el reporte.');
        }

        const res =
          targetFormat === 'pdf'
            ? await generateAndPersistReportPdf(freshData)
            : await generateAndPersistReportXlsx(freshData);

        if (!isMountedRef.current || !isFocusedRef.current) return;
        refreshReports();

        const shareResult = await shareReportFile(res.persistentUri, targetFormat);
        if (!isMountedRef.current || !isFocusedRef.current) return;

        const formatLabel = targetFormat === 'pdf' ? 'PDF' : 'Excel (.xlsx)';
        if (shareResult === 'shared_sheet_opened') {
          setReportFeedback(
            `Reporte ${formatLabel} guardado localmente y hoja de compartir abierta.`,
          );
        } else {
          setReportFeedback(
            `Reporte ${formatLabel} guardado localmente (hoja de compartir no disponible).`,
          );
        }

        router.navigate('/vitales/reporte-estado?archivo=' + encodeURIComponent(res.filename));
      });
    } catch {
      if (!isMountedRef.current || !isFocusedRef.current) return;
      const formatLabel = targetFormat === 'pdf' ? 'PDF' : 'Excel';
      setReportError(
        `No se pudo generar el reporte en formato ${formatLabel} en este dispositivo.`,
      );
    }
  }

  async function handleDeleteReport(filename: string) {
    if (!patientId || saving) return;
    setReportFeedback(null);
    setReportError(null);
    try {
      const ok = await deletePatientReport(patientId, filename);
      if (!isMountedRef.current || !isFocusedRef.current) return;
      if (ok) {
        setReportFeedback('Reporte eliminado del almacenamiento local.');
      } else {
        setReportError('No se pudo encontrar el archivo del reporte para eliminarlo.');
      }
      refreshReports();
    } catch {
      if (!isMountedRef.current || !isFocusedRef.current) return;
      setReportError('Error al eliminar el reporte del dispositivo.');
    }
  }

  return (
    <Screen title="Reportes" backTo="/vitales">
      <BodyText>
        Resumen de evolución clínica generado localmente a partir de signos vitales y síntomas en
        este dispositivo.
      </BodyText>

      <SectionTitle>Período</SectionTitle>
      <View style={styles.chips}>
        {([7, 30, 90] as const).map((item) => (
          <ChoiceChip
            key={item}
            label={`${item} días`}
            selected={days === item}
            disabled={saving || loadingData}
            onPress={() => {
              if (saving) return;
              setDays(item);
              setReportFeedback(null);
              setReportError(null);
            }}
          />
        ))}
      </View>

      <SectionTitle>Formato de exportación</SectionTitle>
      <View style={styles.chips}>
        <ChoiceChip
          label="PDF (Documento)"
          selected={selectedFormat === 'pdf'}
          disabled={saving || loadingData}
          onPress={() => {
            if (saving) return;
            setSelectedFormat('pdf');
            setReportFeedback(null);
            setReportError(null);
          }}
        />
        <ChoiceChip
          label="Excel (.xlsx)"
          selected={selectedFormat === 'xlsx'}
          disabled={saving || loadingData}
          onPress={() => {
            if (saving) return;
            setSelectedFormat('xlsx');
            setReportFeedback(null);
            setReportError(null);
          }}
        />
      </View>
      <BodyText>
        {selectedFormat === 'pdf'
          ? 'Documento estructurado con resumen, signos vitales y detalle de síntomas con formato legible.'
          : 'Planilla Excel (.xlsx) con tres hojas independientes: Resumen, Signos vitales y Síntomas.'}
      </BodyText>

      {error ? (
        <>
          <EmptyState
            icon="alert-circle"
            title="Error al consultar mediciones"
            description="No se pudieron cargar los datos de evolución clínica en este dispositivo."
          />
          <VisualButton label="Reintentar" secondary onPress={refreshData} />
        </>
      ) : (
        <>
          <InfoCard>
            <SectionTitle>Resumen de datos clínicos en el período</SectionTitle>
            <DetailRow label="Período evaluado" value={`${days} días`} />
            <DetailRow
              label="Formato seleccionado"
              value={selectedFormat === 'pdf' ? 'PDF (Documento)' : 'Excel (.xlsx)'}
            />
            <DetailRow
              label="Signos vitales registrados"
              value={
                loadingData
                  ? 'Calculando…'
                  : `${reportData?.summary.vitalsCount ?? 0} ${
                      (reportData?.summary.vitalsCount ?? 0) === 1 ? 'registro' : 'registros'
                    }`
              }
            />
            <DetailRow
              label="Síntomas reportados"
              value={
                loadingData
                  ? 'Calculando…'
                  : `${reportData?.summary.symptomsCount ?? 0} ${
                      (reportData?.summary.symptomsCount ?? 0) === 1 ? 'reporte' : 'reportes'
                    }`
              }
            />
            {reportData?.summary.avgTemperature !== null &&
            reportData?.summary.avgTemperature !== undefined ? (
              <DetailRow
                label="Temperatura prom."
                value={`${reportData.summary.avgTemperature.toLocaleString('es-CL')} °C`}
              />
            ) : null}
            {reportData?.summary.avgPulse !== null && reportData?.summary.avgPulse !== undefined ? (
              <DetailRow
                label="Pulso prom."
                value={`${reportData.summary.avgPulse.toLocaleString('es-CL')} lpm`}
              />
            ) : null}
            <StatusPill>Almacenamiento local aislado</StatusPill>

            {existingForPeriodAndFormat ? (
              <BodyText>
                Ya existe un reporte {selectedFormat.toUpperCase()} guardado para los últimos {days}{' '}
                días (
                {existingForPeriodAndFormat.generatedAt
                  ? formatDate(existingForPeriodAndFormat.generatedAt)
                  : 'reciente'}
                ). Al generar uno nuevo se actualizará de forma segura.
              </BodyText>
            ) : null}
            {reportFeedback ? <StatusPill>{reportFeedback}</StatusPill> : null}
            {reportError ? <Text style={styles.errorText}>{reportError}</Text> : null}
          </InfoCard>

          {!loadingData && !hasClinicalData ? (
            <InfoCard>
              <BodyText>
                No hay signos vitales ni síntomas registrados para este paciente en los últimos{' '}
                {days} días. Para generar un reporte se requiere al menos un registro de signo vital
                o síntoma.
              </BodyText>
              <VisualButton
                label="Registrar signos vitales"
                onPress={() => router.navigate('/vitales/registrar')}
              />
            </InfoCard>
          ) : (
            <VisualButton
              label={
                saving
                  ? `Generando ${selectedFormat.toUpperCase()}…`
                  : existingForPeriodAndFormat
                    ? `Actualizar y compartir ${selectedFormat.toUpperCase()}`
                    : `Generar y compartir ${selectedFormat.toUpperCase()}`
              }
              disabled={loadingData || saving || !hasClinicalData}
              onPress={handleGenerateAndShare}
            />
          )}
        </>
      )}

      <SectionTitle>Reportes guardados en el dispositivo</SectionTitle>
      {loadingReports ? (
        <BodyText>Cargando reportes guardados…</BodyText>
      ) : errorReports ? (
        <InfoCard>
          <EmptyState
            icon="alert-circle"
            title="Error al cargar reportes guardados"
            description="No se pudieron leer los archivos del almacenamiento local."
          />
          <VisualButton label="Reintentar lectura" secondary onPress={refreshReports} />
        </InfoCard>
      ) : savedReports.length === 0 ? (
        <InfoCard>
          <BodyText>No hay reportes generados previamente en este dispositivo.</BodyText>
        </InfoCard>
      ) : (
        savedReports.map((report) => {
          const sizeKb = report.sizeBytes ? (report.sizeBytes / 1024).toFixed(1) : null;
          const formattedDate = report.generatedAt ? formatDate(report.generatedAt) : 'Reciente';
          const isPdf = report.format === 'pdf';

          return (
            <InfoCard key={report.filename}>
              <View style={styles.cardHeader}>
                <Feather
                  name={isPdf ? 'file-text' : 'grid'}
                  size={24}
                  color={appTheme.colors.primary}
                />
                <View style={styles.cardHeaderCopy}>
                  <Text style={styles.cardTitle}>
                    {report.periodDays ? `Reporte (${report.periodDays} días)` : 'Reporte clínico'}
                  </Text>
                  <BodyText>Generado el {formattedDate}</BodyText>
                </View>
                <StatusPill>{isPdf ? 'PDF' : 'Excel'}</StatusPill>
              </View>

              <DetailRow label="Archivo" value={report.filename} />
              <DetailRow label="Tamaño" value={sizeKb ? `${sizeKb} KB` : 'No disponible'} />
              <DetailRow
                label="Formato"
                value={isPdf ? 'Documento PDF' : 'Planilla Excel (.xlsx)'}
              />

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
                  disabled={saving}
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

  const fileFormat = archivo ? (parseFormatFromReportFilename(archivo) ?? 'pdf') : 'pdf';

  async function handleReshare() {
    if (!targetFile || !fileExists) return;
    setSharingFeedback(null);
    const result = await shareReportFile(targetFile.uri, fileFormat);
    if (result === 'shared_sheet_opened') {
      setSharingFeedback('Hoja de compartir del sistema abierta.');
    } else {
      setSharingFeedback(
        'No se pudo abrir la hoja de compartir. El archivo permanece guardado en el dispositivo.',
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
        <DetailRow
          label="Formato"
          value={fileFormat === 'pdf' ? 'Documento PDF' : 'Planilla Excel (.xlsx)'}
        />
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
