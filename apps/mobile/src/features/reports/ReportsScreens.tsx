import { AppIcon as Feather } from '../../components/AppIcon';
import { File } from 'expo-file-system';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import { DetailsDisclosure } from '../../components/DetailsDisclosure';
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

interface SavedReportCardProps {
  report: PatientReportItem;
  saving: boolean;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
}

function SavedReportCard({ report, saving, onOpen, onShare, onDelete }: SavedReportCardProps) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const [expanded, setExpanded] = useState(false);

  const sizeKb = report.sizeBytes ? (report.sizeBytes / 1024).toFixed(1) : null;
  const formattedDate = report.generatedAt ? formatDate(report.generatedAt) : 'Reciente';
  const isPdf = report.format === 'pdf';
  const title = report.periodDays
    ? `Reporte ${isPdf ? 'PDF' : 'Excel'} de ${report.periodDays} días`
    : isPdf
      ? 'Reporte PDF'
      : 'Reporte Excel';

  const handleToggleDetails = () => {
    const next = !expanded;
    setExpanded(next);
    AccessibilityInfo.announceForAccessibility(
      next ? 'Detalles del archivo mostrados' : 'Detalles del archivo ocultos',
    );
  };

  return (
    <InfoCard>
      <View style={styles.cardHeader}>
        <Feather
          name={isPdf ? 'file-text' : 'grid'}
          size={24}
          color={appTheme.colors.primary}
          accessible={false}
        />
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.cardTitle}>{title}</Text>
          <BodyText>Generado el {formattedDate}</BodyText>
        </View>
        <StatusPill>{isPdf ? 'PDF' : 'Excel'}</StatusPill>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Ocultar detalles del archivo' : 'Ver detalles del archivo'}
        accessibilityState={{ expanded }}
        onPress={handleToggleDetails}
        style={styles.detailsToggle}
      >
        <Text style={styles.detailsToggleText}>Detalles del archivo</Text>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={appTheme.colors.primary}
          accessible={false}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.techDetailsContainer}>
          <DetailRow label="Archivo" value={report.filename} layout="vertical" />
          <DetailRow label="Tamaño" value={sizeKb ? `${sizeKb} KB` : 'No disponible'} />
          <DetailRow label="Formato" value={isPdf ? 'Documento PDF' : 'Planilla Excel (.xlsx)'} />
        </View>
      ) : null}

      <View style={styles.reportActions}>
        <VisualButton label={isPdf ? 'Ver reporte PDF' : 'Ver planilla Excel'} onPress={onOpen} />
        <VisualButton
          label={isPdf ? 'Compartir PDF' : 'Compartir Excel'}
          secondary
          onPress={onShare}
        />
        <VisualButton label="Eliminar reporte" secondary disabled={saving} onPress={onDelete} />
      </View>
    </InfoCard>
  );
}

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

  const { repository, patientId, runSave, saving, manager } = useLocalData();

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

  async function handleGenerateAndOpen() {
    if (!repository || !patientId || saving || !reportData || !hasClinicalData) return;
    const targetDays = days;
    const targetFormat = selectedFormat;
    const activePatient = manager?.getPatientId?.() ?? patientId;
    const activeEpoch = manager?.getContextEpoch?.() ?? 0;

    setReportFeedback(null);
    setReportError(null);

    let failedStage: 'datos' | 'serializacion' | 'persistencia' | 'navegacion' = 'datos';
    try {
      await runSave(async () => {
        // 1. Etapa de datos: Capturar instantánea fresca al momento de confirmar
        failedStage = 'datos';
        const freshData = await repository.reports.getReportData(targetDays);
        if (freshData.summary.vitalsCount === 0 && freshData.summary.symptomsCount === 0) {
          throw new Error('No hay registros clínicos en el período para generar el reporte.');
        }

        const checkPatientBefore = manager?.getPatientId?.() ?? patientId;
        const checkEpochBefore = manager?.getContextEpoch?.() ?? 0;
        if (checkPatientBefore !== activePatient || checkEpochBefore !== activeEpoch) {
          return;
        }

        // 2. Etapa de serialización y persistencia cifrada
        failedStage = 'persistencia';
        const res =
          targetFormat === 'pdf'
            ? await generateAndPersistReportPdf(freshData)
            : await generateAndPersistReportXlsx(freshData);

        const checkPatientAfter = manager?.getPatientId?.() ?? patientId;
        const checkEpochAfter = manager?.getContextEpoch?.() ?? 0;
        if (
          !isMountedRef.current ||
          !isFocusedRef.current ||
          checkPatientAfter !== activePatient ||
          checkEpochAfter !== activeEpoch
        ) {
          return;
        }

        // 3. Actualizar listado local y notificar guardado exitoso (sin invocar compartir)
        refreshReports();
        setReportFeedback('Archivo guardado en este teléfono. Puedes abrirlo o compartirlo.');

        // 4. Etapa de navegación: Abrir directamente el visor interno
        failedStage = 'navegacion';
        const viewerRoute = targetFormat === 'pdf' ? '/reportes/visor-pdf' : '/reportes/visor-xlsx';
        router.push({
          pathname: viewerRoute as never,
          params: {
            uri: res.persistentUri,
            filename: res.filename,
            periodDays: String(targetDays),
          },
        });
      });
    } catch (err) {
      if (
        !isMountedRef.current ||
        !isFocusedRef.current ||
        (manager?.getContextEpoch?.() ?? 0) !== activeEpoch
      ) {
        return;
      }
      const formatLabel = targetFormat === 'pdf' ? 'PDF' : 'Excel';
      const detail = err instanceof Error ? err.message : '';
      if (failedStage === 'datos') {
        setReportError(
          detail || 'No se pudieron consultar los registros clínicos para generar el reporte.',
        );
      } else if (failedStage === 'navegacion') {
        setReportError(
          `El reporte ${formatLabel} se guardó en este teléfono, pero no se pudo abrir el visor automáticamente.`,
        );
      } else {
        setReportError(
          `No se pudo guardar el reporte en formato ${formatLabel} en este dispositivo.`,
        );
      }
    }
  }

  async function handleShareSavedReport(report: PatientReportItem) {
    const activePatient = manager?.getPatientId?.() ?? patientId;
    const activeEpoch = manager?.getContextEpoch?.() ?? 0;
    if (!activePatient || saving) return;

    setReportFeedback(null);
    setReportError(null);

    try {
      const dir = getPatientReportDirectory(activePatient);
      const targetUri = report.uri || `${dir.uri}/${report.filename}`;
      const result = await shareReportFile(targetUri, report.format);
      if (
        !isMountedRef.current ||
        !isFocusedRef.current ||
        (manager?.getContextEpoch?.() ?? 0) !== activeEpoch
      ) {
        return;
      }
      if (result === 'shared_sheet_opened') {
        setReportFeedback('Hoja de compartir del sistema abierta. El reporte sigue guardado.');
      } else {
        setReportFeedback(
          'No se completó el envío externo. Tu archivo sigue guardado en este teléfono.',
        );
      }
    } catch {
      if (!isMountedRef.current || !isFocusedRef.current) return;
      setReportFeedback(
        'No se pudo abrir la hoja de compartir. Tu archivo sigue guardado en este teléfono.',
      );
    }
  }

  async function handleDeleteReport(
    filename: string,
    expectedPatientId?: string,
    expectedEpoch?: number,
  ) {
    const activePatient = manager?.getPatientId?.() ?? patientId;
    const activeEpoch = manager?.getContextEpoch?.() ?? 0;

    if (
      !activePatient ||
      saving ||
      !isMountedRef.current ||
      !isFocusedRef.current ||
      (expectedPatientId && activePatient !== expectedPatientId) ||
      (expectedEpoch !== undefined && activeEpoch !== expectedEpoch)
    ) {
      return;
    }

    setReportFeedback(null);
    setReportError(null);
    try {
      const ok = await runSave(async () => {
        const checkPatient = manager?.getPatientId?.() ?? patientId;
        const checkEpoch = manager?.getContextEpoch?.() ?? 0;
        if (
          checkPatient !== activePatient ||
          (expectedEpoch !== undefined && checkEpoch !== expectedEpoch)
        ) {
          return false;
        }
        return deletePatientReport(activePatient, filename);
      });
      if (
        !isMountedRef.current ||
        !isFocusedRef.current ||
        (manager?.getContextEpoch?.() ?? 0) !== activeEpoch
      ) {
        return;
      }
      if (ok) {
        setReportFeedback('Reporte eliminado de este teléfono.');
      } else {
        setReportError('No se pudo encontrar el archivo del reporte para eliminarlo.');
      }
      refreshReports();
    } catch {
      if (!isMountedRef.current || !isFocusedRef.current) return;
      setReportError('Error al eliminar el reporte del dispositivo.');
    }
  }

  function confirmDeleteReport(filename: string) {
    const dialogPatientId = manager?.getPatientId?.() ?? patientId;
    const dialogEpoch = manager?.getContextEpoch?.() ?? 0;

    Alert.alert(
      '¿Eliminar este reporte?',
      'Se eliminará el archivo de este dispositivo. Tus mediciones y síntomas se conservarán.',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
        },
        {
          text: 'Eliminar reporte',
          style: 'destructive',
          onPress: () => {
            const currentPatientId = manager?.getPatientId?.() ?? patientId;
            const currentEpoch = manager?.getContextEpoch?.() ?? 0;
            // Si el paciente o la época cambiaron mientras el diálogo estaba abierto, abortar
            if (
              !isMountedRef.current ||
              !isFocusedRef.current ||
              currentPatientId !== dialogPatientId ||
              currentEpoch !== dialogEpoch ||
              !dialogPatientId
            ) {
              return;
            }
            void handleDeleteReport(filename, dialogPatientId, dialogEpoch);
          },
        },
      ],
      { cancelable: true },
    );
  }

  return (
    <Screen mascotPose="resumen" title="Mis reportes">
      <BodyText>Crea un resumen de tus mediciones y síntomas para compartirlo.</BodyText>
      <InfoCard>
        <SectionTitle>Generar nuevo informe</SectionTitle>
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

        <SectionTitle>Formato del archivo</SectionTitle>
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
      </InfoCard>

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
            <DetailsDisclosure title="Ver resumen del período">
              <SectionTitle>Resumen de datos clínicos en el período</SectionTitle>
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
              {reportData?.summary.avgPulse !== null &&
              reportData?.summary.avgPulse !== undefined ? (
                <DetailRow
                  label="Pulso prom."
                  value={`${reportData.summary.avgPulse.toLocaleString('es-CL')} lpm`}
                />
              ) : null}
              <StatusPill>Guardado en este teléfono</StatusPill>

              {existingForPeriodAndFormat ? (
                <BodyText>
                  Ya existe un reporte {selectedFormat.toUpperCase()} guardado para los últimos{' '}
                  {days} días (
                  {existingForPeriodAndFormat.generatedAt
                    ? formatDate(existingForPeriodAndFormat.generatedAt)
                    : 'reciente'}
                  ). Al generar uno nuevo se actualizará de forma segura.
                </BodyText>
              ) : null}
            </DetailsDisclosure>
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
                onPress={() => router.push('/vitales/registrar')}
              />
            </InfoCard>
          ) : (
            <VisualButton
              label={
                saving
                  ? `Generando ${selectedFormat.toUpperCase()}…`
                  : existingForPeriodAndFormat
                    ? `Actualizar y abrir ${selectedFormat.toUpperCase()}`
                    : `Generar y abrir ${selectedFormat.toUpperCase()}`
              }
              disabled={loadingData || saving || !hasClinicalData}
              onPress={handleGenerateAndOpen}
            />
          )}
        </>
      )}

      <SectionTitle>Reportes guardados en el dispositivo</SectionTitle>
      <BodyText>Abre un informe para leerlo aquí. Solo se comparte cuando tú lo decides.</BodyText>
      {loadingReports ? (
        <BodyText>Cargando reportes guardados…</BodyText>
      ) : errorReports ? (
        <InfoCard>
          <EmptyState
            icon="alert-circle"
            title="Error al cargar reportes guardados"
            description="No se pudieron abrir tus informes guardados."
          />
          <VisualButton label="Reintentar lectura" secondary onPress={refreshReports} />
        </InfoCard>
      ) : savedReports.length === 0 ? (
        <InfoCard>
          <BodyText>No hay reportes generados previamente en este dispositivo.</BodyText>
        </InfoCard>
      ) : (
        savedReports.map((report) => (
          <SavedReportCard
            key={report.filename}
            report={report}
            saving={saving}
            onOpen={() => {
              const route =
                report.format === 'pdf' ? '/reportes/visor-pdf' : '/reportes/visor-xlsx';
              router.push({
                pathname: route as never,
                params: {
                  uri: report.uri,
                  filename: report.filename,
                  periodDays: String(report.periodDays ?? 30),
                },
              });
            }}
            onShare={() => {
              void handleShareSavedReport(report);
            }}
            onDelete={() => confirmDeleteReport(report.filename)}
          />
        ))
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
      <Screen mascotPose="confirmacion" title="Estado del reporte">
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
    <Screen mascotPose="confirmacion" title="Estado del reporte">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Reporte generado y guardado</SectionTitle>
        <StatusPill>Archivo guardado. Puedes compartirlo cuando quieras.</StatusPill>
        <DetailRow label="Archivo" value={archivo} layout="vertical" />
        <DetailRow
          label="Formato"
          value={fileFormat === 'pdf' ? 'Documento PDF' : 'Planilla Excel (.xlsx)'}
        />
        <DetailRow label="Tamaño" value={sizeKb ? `${sizeKb} KB` : 'No disponible'} />
        <DetailRow label="Generado el" value={formattedDate} />
        {sharingFeedback ? <StatusPill>{sharingFeedback}</StatusPill> : null}
      </InfoCard>

      <VisualButton
        label={fileFormat === 'pdf' ? 'Ver reporte PDF' : 'Ver planilla Excel'}
        onPress={() => {
          const route = fileFormat === 'pdf' ? '/reportes/visor-pdf' : '/reportes/visor-xlsx';
          router.push({
            pathname: route as never,
            params: {
              uri: targetFile.uri,
              filename: archivo,
            },
          });
        }}
      />
      <VisualButton
        label={fileFormat === 'pdf' ? 'Compartir PDF' : 'Compartir Excel'}
        secondary
        onPress={handleReshare}
      />
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
    detailsToggle: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.xs,
    },
    detailsToggleText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
    techDetailsContainer: {
      gap: theme.spacing.xs,
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
  });
}
