import { AppIcon as Feather } from '../../components/AppIcon';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as XLSX from 'xlsx';

import { DocumentScreen } from '../../components/DocumentScreen';
import { BodyText, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { getReportPeriodText } from '../../content/patient-copy';
import * as reportStorage from '../../data/local/files/report-storage';
import { clinicalFileLease, readClinicalFile } from '../../data/sync/file-protection';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

interface ParsedSheet {
  name: string;
  rows: Array<Array<string | number | boolean | null>>;
  hasHeader: boolean;
}

interface SelectedCellInfo {
  sheetName: string;
  rowIndex: number;
  columnName: string;
  value: string;
}

const ROWS_PER_PAGE = 50;

export function SpreadsheetReportViewer() {
  const { uri, filename, periodDays } = useLocalSearchParams<{
    uri?: string;
    filename?: string;
    periodDays?: string;
  }>();

  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { fontScale } = useWindowDimensions();
  const { patientId, manager } = useLocalData();

  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [choosingSheet, setChoosingSheet] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCellInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [resolvedUri, setResolvedUri] = useState<string | null>(uri ?? null);

  const resolveTargetFile = useCallback((): { file: File; canonicalUri: string } => {
    const activePatient = manager?.getPatientId?.() ?? patientId;
    if (!activePatient) {
      throw new Error('No hay una sesión de paciente activa para abrir este reporte.');
    }
    if (typeof reportStorage.resolvePatientReportFile === 'function') {
      const resolved = reportStorage.resolvePatientReportFile(activePatient, { filename, uri });
      return { file: resolved.file, canonicalUri: resolved.canonicalUri };
    }
    if (uri && uri.includes('/reportes_locales/')) {
      const match = uri.match(/[/\\]reportes_locales[/\\](?:[0-9a-f]{24}[/\\])?([^/\\]+)[/\\]/);
      if (match && match[1] !== activePatient) {
        throw new Error('El reporte solicitado pertenece a otro paciente.');
      }
    }
    const targetUri = uri || (filename ? `/reports/${activePatient}/${filename}` : '');
    if (!targetUri) {
      throw new Error('No se proporcionó la ubicación del archivo Excel.');
    }
    return { file: new File(targetUri), canonicalUri: targetUri };
  }, [filename, manager, patientId, uri]);

  useEffect(() => {
    let active = true;
    const startPatient = manager?.getPatientId?.() ?? patientId;
    const startEpoch = manager?.getContextEpoch?.() ?? 0;

    async function loadSpreadsheet() {
      setLoading(true);
      setError(null);
      setSelectedCell(null);
      setChoosingSheet(false);
      setSheets([]);

      if (!uri && !filename) {
        setError('No se proporcionó la ubicación del archivo Excel.');
        setLoading(false);
        return;
      }

      try {
        const { file, canonicalUri } = resolveTargetFile();
        if (active) {
          setResolvedUri(canonicalUri);
        }

        const assertCurrent = clinicalFileLease(canonicalUri);
        assertCurrent();

        const encryptedBytes = await file.bytes();
        const midPatient = manager?.getPatientId?.() ?? patientId;
        const midEpoch = manager?.getContextEpoch?.() ?? 0;
        if (!active || midPatient !== startPatient || midEpoch !== startEpoch) {
          return;
        }

        const decryptedBytes = await readClinicalFile(canonicalUri, encryptedBytes);
        const endPatient = manager?.getPatientId?.() ?? patientId;
        const endEpoch = manager?.getContextEpoch?.() ?? 0;
        if (!active || endPatient !== startPatient || endEpoch !== startEpoch) {
          return;
        }

        const workbook = XLSX.read(decryptedBytes, { type: 'array' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('La planilla Excel no contiene hojas legibles.');
        }

        const parsed: ParsedSheet[] = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(
            worksheet,
            { header: 1, defval: null, raw: false },
          );
          const nonEmptyRows = rawRows.filter((r) =>
            r.some((cell) => cell !== null && cell !== undefined && String(cell) !== ''),
          );
          return {
            name: sheetName,
            rows: nonEmptyRows,
            hasHeader:
              (nonEmptyRows[0] ?? []).filter((value) => value !== null && value !== '').length > 1,
          };
        });

        if (active) {
          setSheets(parsed);
          setPageIndex(0);
          // Priorizar pestaña de Signos Vitales si existe
          const vitalsIndex = parsed.findIndex((s) => s.name.toLowerCase().includes('vital'));
          if (vitalsIndex >= 0) {
            setActiveSheetIndex(vitalsIndex);
          } else {
            setActiveSheetIndex(0);
          }
        }
      } catch (e) {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : 'No se pudo leer la planilla Excel protegida en este dispositivo.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadSpreadsheet();
    return () => {
      active = false;
    };
  }, [uri, filename, patientId, manager, resolveTargetFile, retryCount]);

  const handleRetryRead = () => {
    setRetryCount((prev) => prev + 1);
  };

  const handleShare = async () => {
    const shareTargetUri = resolvedUri ?? uri;
    if (!shareTargetUri || sharing) return;
    const startPatient = manager?.getPatientId?.() ?? patientId;
    const startEpoch = manager?.getContextEpoch?.() ?? 0;

    setSharing(true);
    setShareFeedback(null);
    try {
      const res = await reportStorage.shareReportFile(shareTargetUri, 'xlsx');
      const endPatient = manager?.getPatientId?.() ?? patientId;
      const endEpoch = manager?.getContextEpoch?.() ?? 0;
      if (endPatient !== startPatient || endEpoch !== startEpoch) return;

      if (res === 'shared_sheet_opened') {
        AccessibilityInfo.announceForAccessibility('Menú para compartir planilla Excel abierto.');
      } else {
        setShareFeedback(
          'No se abrió la hoja de compartir. Tu planilla sigue guardada en este teléfono.',
        );
      }
    } catch (e) {
      setShareFeedback(
        e instanceof Error
          ? e.message
          : 'No se pudo compartir la planilla. El archivo sigue guardado en este teléfono.',
      );
    } finally {
      setSharing(false);
    }
  };

  const currentSheet = sheets[activeSheetIndex] ?? null;
  const columns = useMemo(() => {
    const rows = currentSheet?.rows ?? [];
    const count = Math.max(0, ...rows.map((row) => row.length));
    return Array.from({ length: count }, (_, index) => {
      const sample = rows.slice(0, 51).map((row) => String(row[index] ?? ''));
      const longest = Math.max(12, ...sample.map((text) => Math.min(36, text.length)));
      return {
        title: currentSheet?.hasHeader
          ? String(rows[0]?.[index] ?? `Columna ${index + 1}`)
          : index === 0
            ? 'Campo'
            : index === 1
              ? 'Detalle'
              : `Columna ${index + 1}`,
        width: Math.ceil(
          Math.max(130, Math.min(280, longest * 7.5 + 24)) * Math.min(fontScale, 1.5),
        ),
      };
    });
  }, [currentSheet, fontScale]);
  const tableWidth = 52 + columns.reduce((sum, column) => sum + column.width, 0);
  const bodyRows = currentSheet
    ? currentSheet.hasHeader
      ? currentSheet.rows.slice(1)
      : currentSheet.rows
    : [];
  const totalPages = Math.max(1, Math.ceil(bodyRows.length / ROWS_PER_PAGE));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const visibleRows = bodyRows.slice(
    safePageIndex * ROWS_PER_PAGE,
    (safePageIndex + 1) * ROWS_PER_PAGE,
  );

  const parsedDays = periodDays ? (Number(periodDays) as 7 | 30 | 90) : 30;
  const periodLabel = getReportPeriodText(parsedDays);

  return (
    <DocumentScreen>
      {/* Barra de herramientas superior */}
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a la lista de reportes"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.toolbarBtn, pressed && styles.pressed]}
        >
          <Feather name="arrow-left" size={20} color={appTheme.colors.text} />
          {fontScale < 1.3 ? <Text style={styles.toolbarBtnText}>Volver</Text> : null}
        </Pressable>

        <View style={styles.titleBox}>
          <Text style={styles.screenHeading} numberOfLines={1}>
            Planilla Excel ({periodLabel})
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Compartir planilla Excel con tu médico"
          disabled={sharing || Boolean(error)}
          onPress={handleShare}
          style={({ pressed }) => [
            styles.toolbarBtn,
            styles.shareBtn,
            pressed && styles.pressed,
            (sharing || Boolean(error)) && styles.disabled,
          ]}
        >
          <Feather name="share-2" size={18} color={appTheme.colors.primary} />
          <Text style={styles.shareBtnText}>Enviar</Text>
        </Pressable>
      </View>

      {shareFeedback ? (
        <View style={styles.feedbackBanner} accessibilityRole="alert">
          <Feather name="alert-circle" size={18} color={appTheme.colors.error} />
          <Text style={styles.feedbackText}>{shareFeedback}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={appTheme.colors.primary} />
          <BodyText style={{ marginTop: 12 }}>Cargando planilla de cálculo…</BodyText>
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <InfoCard>
            <Feather name="alert-triangle" size={32} color={appTheme.colors.error} />
            <SectionTitle>No se pudo abrir la planilla</SectionTitle>
            <BodyText>{error}</BodyText>
            <VisualButton label="Reintentar lectura" onPress={handleRetryRead} />
            <VisualButton label="Volver a reportes" onPress={() => router.back()} secondary />
          </InfoCard>
        </View>
      ) : (
        <View style={styles.tableContainer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Cambiar hoja. Actual: ${currentSheet?.name ?? 'Sin hoja'}`}
            onPress={() => setChoosingSheet(true)}
            style={styles.sheetSelector}
          >
            <Text numberOfLines={1} style={[styles.sheetTabText, { flex: 1 }]}>
              {currentSheet?.name ?? 'Sin hoja'}
            </Text>
            <Text style={styles.pageIndicator}>{bodyRows.length} registros</Text>
            <Feather name="chevron-down" size={20} color={appTheme.colors.text} />
          </Pressable>
          <Text style={styles.scrollHint}>
            {columns.length} columnas · Desliza hacia los lados para ver más
          </Text>

          <Modal
            visible={choosingSheet}
            transparent
            animationType="fade"
            onRequestClose={() => setChoosingSheet(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard} accessibilityViewIsModal>
                <SectionTitle>Elegir hoja</SectionTitle>
                <ScrollView style={{ flexGrow: 0 }}>
                  {sheets.map((sheet, index) => (
                    <Pressable
                      key={sheet.name}
                      accessibilityRole="button"
                      accessibilityLabel={`Abrir hoja ${sheet.name}`}
                      accessibilityState={{ selected: index === activeSheetIndex }}
                      style={styles.sheetSelector}
                      onPress={() => {
                        setActiveSheetIndex(index);
                        setPageIndex(0);
                        setSelectedCell(null);
                        setChoosingSheet(false);
                      }}
                    >
                      <Text style={[styles.sheetTabText, { flex: 1 }]}>{sheet.name}</Text>
                      {index === activeSheetIndex ? (
                        <Feather name="check" size={20} color={appTheme.colors.primary} />
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
                <VisualButton
                  label="Cerrar lista de hojas"
                  secondary
                  onPress={() => setChoosingSheet(false)}
                />
              </View>
            </View>
          </Modal>

          <Modal
            visible={selectedCell !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setSelectedCell(null)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard} accessibilityViewIsModal>
                <SectionTitle>{selectedCell?.columnName ?? 'Detalle de celda'}</SectionTitle>
                <Text style={styles.pageIndicator}>
                  {selectedCell?.sheetName} · Fila {(selectedCell?.rowIndex ?? 0) + 1}
                </Text>
                <ScrollView style={{ flexGrow: 0 }}>
                  <Text selectable style={styles.cellDetailValue}>
                    {selectedCell?.value || 'Celda vacía'}
                  </Text>
                </ScrollView>
                <VisualButton
                  label="Cerrar detalle de celda"
                  secondary
                  onPress={() => setSelectedCell(null)}
                />
              </View>
            </View>
          </Modal>

          {/* Controles de paginación cuando una hoja tiene más de 50 filas */}
          {totalPages > 1 ? (
            <View style={styles.paginationBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filas anteriores"
                disabled={safePageIndex <= 0}
                onPress={() => setPageIndex((p) => Math.max(0, p - 1))}
                style={[styles.pageBtn, safePageIndex <= 0 && styles.disabled]}
              >
                <Feather name="chevron-left" size={18} color={appTheme.colors.text} />
                <Text style={styles.pageBtnText}>Anterior</Text>
              </Pressable>
              <Text style={styles.pageIndicator}>
                Filas {safePageIndex * ROWS_PER_PAGE + 1}–
                {Math.min(bodyRows.length, (safePageIndex + 1) * ROWS_PER_PAGE)} de{' '}
                {bodyRows.length}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filas siguientes"
                disabled={safePageIndex >= totalPages - 1}
                onPress={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                style={[styles.pageBtn, safePageIndex >= totalPages - 1 && styles.disabled]}
              >
                <Text style={styles.pageBtnText}>Siguiente</Text>
                <Feather name="chevron-right" size={18} color={appTheme.colors.text} />
              </Pressable>
            </View>
          ) : null}

          {/* Cuadrícula de datos con scroll bidireccional */}
          <ScrollView
            horizontal
            nestedScrollEnabled
            style={styles.horizontalScroll}
            contentContainerStyle={{ width: tableWidth, alignItems: 'stretch' }}
          >
            <ScrollView
              nestedScrollEnabled
              style={[styles.verticalScroll, { width: tableWidth }]}
              stickyHeaderIndices={[0]}
            >
              {/* Fila de cabecera fija */}
              <View style={styles.tableHeaderRow}>
                <View style={[styles.cell, { width: 52 }]}>
                  <Text style={styles.headerCellText}>Fila</Text>
                </View>
                {columns.map((column, cIdx) => (
                  <View
                    key={cIdx}
                    style={[styles.cell, styles.headerCell, { width: column.width }]}
                  >
                    <Text numberOfLines={3} style={styles.headerCellText}>
                      {column.title}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Filas de datos */}
              {visibleRows.length > 0 ? (
                visibleRows.map((row, rIdx) => {
                  const absoluteRowIndex = safePageIndex * ROWS_PER_PAGE + rIdx;
                  const isEven = absoluteRowIndex % 2 === 0;
                  return (
                    <View
                      key={absoluteRowIndex}
                      style={[styles.tableDataRow, isEven && styles.tableDataRowEven]}
                    >
                      <View style={[styles.cell, { width: 52 }]}>
                        <Text style={styles.pageIndicator}>{absoluteRowIndex + 1}</Text>
                      </View>
                      {columns.map((column, cIdx) => {
                        const val = row[cIdx];
                        const strVal = val !== undefined && val !== null ? String(val) : '';
                        const colLabel = column.title;
                        return (
                          <Pressable
                            key={cIdx}
                            accessibilityRole="button"
                            accessibilityLabel={`${colLabel}, fila ${absoluteRowIndex + 1}: ${strVal || 'vacío'}`}
                            onPress={() =>
                              setSelectedCell({
                                sheetName: currentSheet?.name ?? 'Hoja',
                                rowIndex: absoluteRowIndex,
                                columnName: colLabel,
                                value: strVal,
                              })
                            }
                            style={[styles.cell, { width: column.width }]}
                          >
                            <Text numberOfLines={3} style={styles.dataCellText}>
                              {strVal}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })
              ) : (
                <View style={styles.emptyRow}>
                  <Text style={styles.emptyText}>Sin registros en esta hoja</Text>
                </View>
              )}
            </ScrollView>
          </ScrollView>
        </View>
      )}
    </DocumentScreen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    sheetSelector: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    scrollHint: { fontSize: 13, color: colors.secondary, padding: 8 },
    modalOverlay: {
      flex: 1,
      padding: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalCard: {
      width: '100%',
      maxWidth: 600,
      maxHeight: '85%',
      padding: 16,
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 20,
    },
    toolbar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderColor: colors.border,
      gap: theme.spacing.xs,
    },
    toolbarBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 48,
      paddingHorizontal: 10,
      borderRadius: theme.radius.sm,
    },
    toolbarBtnText: {
      fontFamily: 'NunitoSans-SemiBold',
      fontSize: 14,
      color: colors.text,
      fontWeight: '600',
    },
    titleBox: {
      flex: 1,
      alignItems: 'center',
    },
    screenHeading: {
      fontFamily: 'NunitoSans-Bold',
      fontSize: 15,
      fontWeight: '800',
      color: colors.heading ?? colors.text,
    },
    shareBtn: {
      backgroundColor: colors.primaryContainer,
    },
    shareBtnText: {
      fontFamily: 'NunitoSans-Bold',
      fontSize: 13,
      color: colors.primary,
      fontWeight: '700',
    },
    feedbackBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.errorContainer,
      padding: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      marginBottom: theme.spacing.sm,
    },
    feedbackText: {
      fontFamily: 'NunitoSans-Regular',
      fontSize: 13,
      color: colors.error,
      flex: 1,
    },
    centerContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.xl,
    },
    tableContainer: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    sheetTabBar: {
      flexDirection: 'row',
      paddingHorizontal: theme.spacing.xs,
      paddingVertical: theme.spacing.xs,
      backgroundColor: colors.mutedSurface,
      borderBottomWidth: 1.5,
      borderBottomColor: colors.border,
      gap: 6,
    },
    sheetTab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 48,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetTabActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    sheetTabText: {
      fontFamily: 'NunitoSans-SemiBold',
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    sheetTabTextActive: {
      color: colors.onPrimary,
      fontWeight: '700',
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 10,
    },
    badgeActive: {
      backgroundColor: 'rgba(255, 255, 255, 0.25)',
    },
    badgeInactive: {
      backgroundColor: colors.mutedSurface,
    },
    badgeText: {
      fontFamily: 'NunitoSans-Bold',
      fontSize: 11,
      fontWeight: '700',
    },
    badgeTextActive: {
      color: colors.onPrimary,
    },
    badgeTextInactive: {
      color: colors.secondary,
    },
    cellDetailBox: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      backgroundColor: colors.primaryContainer,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 4,
    },
    cellDetailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cellDetailTitle: {
      fontFamily: 'NunitoSans-Bold',
      fontSize: 12,
      fontWeight: '700',
      color: colors.onPrimaryContainer,
      flex: 1,
    },
    closeDetailBtn: {
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellDetailValue: {
      fontFamily: 'NunitoSans-Regular',
      fontSize: 13,
      color: colors.text,
    },
    paginationBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      backgroundColor: colors.mutedSurface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    pageBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 48,
      paddingHorizontal: 8,
    },
    pageBtnText: {
      fontFamily: 'NunitoSans-SemiBold',
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    pageIndicator: {
      fontFamily: 'NunitoSans-Regular',
      fontSize: 12,
      color: colors.secondary,
    },
    horizontalScroll: {
      flex: 1,
    },
    verticalScroll: { flexGrow: 1, flexShrink: 0 },
    gridTable: {
      flexDirection: 'column',
    },
    tableHeaderRow: {
      flexDirection: 'row',
      backgroundColor: colors.mutedSurface,
      borderBottomWidth: 2,
      borderBottomColor: colors.border,
    },
    tableDataRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    tableDataRowEven: {
      backgroundColor: colors.surfaceRaised ?? colors.surface,
    },
    cell: {
      flexShrink: 0,
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRightWidth: 1,
      borderRightColor: colors.border,
      justifyContent: 'center',
    },
    headerCell: {
      paddingVertical: 12,
    },
    headerCellText: {
      fontFamily: 'NunitoSans-Bold',
      fontSize: 13,
      fontWeight: '800',
      color: colors.heading ?? colors.text,
    },
    dataCellText: {
      fontFamily: 'NunitoSans-Regular',
      fontSize: 13,
      color: colors.text,
    },
    emptyRow: {
      padding: theme.spacing.xl,
      alignItems: 'center',
    },
    emptyText: {
      fontFamily: 'NunitoSans-Regular',
      fontSize: 14,
      color: colors.secondary,
    },
    pressed: {
      opacity: 0.7,
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
