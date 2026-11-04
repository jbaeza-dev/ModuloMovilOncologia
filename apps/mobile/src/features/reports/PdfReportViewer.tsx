import { AppIcon as Feather } from '../../components/AppIcon';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { DocumentScreen } from '../../components/DocumentScreen';
import { BodyText, VisualButton } from '../../components/Visual';
import * as reportStorage from '../../data/local/files/report-storage';
import { clinicalFileLease, readClinicalFile } from '../../data/sync/file-protection';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

import { buildPdfJsHtml } from './pdf-viewer-html';
export { buildPdfJsHtml } from './pdf-viewer-html';

export function PdfReportViewer() {
  const { uri, filename } = useLocalSearchParams<{
    uri: string;
    filename: string;
    periodDays?: string;
  }>();

  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { patientId, manager } = useLocalData();
  const { fontScale } = useWindowDimensions();

  const webViewRef = useRef<WebView>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoomPct, setZoomPct] = useState(100);
  const [sharing, setSharing] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [resolvedUri, setResolvedUri] = useState<string | null>(uri ?? null);

  useEffect(() => {
    let active = true;
    const startPatient = manager?.getPatientId?.() ?? patientId;
    const startEpoch = manager?.getContextEpoch?.() ?? 0;

    async function loadPdf() {
      setLoading(true);
      setFileError(null);
      setPdfBase64(null);
      try {
        // 1. Cargar archivo PDF binario real protegido validando pertenencia
        if (uri || filename) {
          try {
            let targetFile: File;
            let canonicalUri = uri ?? '';
            if (startPatient && typeof reportStorage.resolvePatientReportFile === 'function') {
              const resolved = reportStorage.resolvePatientReportFile(startPatient, {
                filename,
                uri,
              });
              targetFile = resolved.file;
              canonicalUri = resolved.canonicalUri;
            } else {
              if (uri && startPatient && uri.includes('/reportes_locales/')) {
                const match = uri.match(
                  /[/\\]reportes_locales[/\\](?:[0-9a-f]{24}[/\\])?([^/\\]+)[/\\]/,
                );
                if (match && match[1] !== startPatient) {
                  throw new Error('El reporte solicitado pertenece a otro paciente.');
                }
              }
              canonicalUri =
                uri || (filename && startPatient ? `/reports/${startPatient}/${filename}` : '');
              targetFile = new File(canonicalUri);
            }
            if (active) {
              setResolvedUri(canonicalUri);
            }

            const assertCurrent = clinicalFileLease(canonicalUri);
            assertCurrent();
            const encryptedBytes = await targetFile.bytes();
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

            let binary = '';
            const len = decryptedBytes.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(decryptedBytes[i]);
            }
            const b64 =
              typeof btoa === 'function'
                ? btoa(binary)
                : Buffer.from(decryptedBytes).toString('base64');
            if (active) {
              setPdfBase64(b64);
            }
          } catch (fileErr) {
            if (active) {
              setFileError(
                fileErr instanceof Error
                  ? fileErr.message
                  : 'No se pudo leer el archivo binario PDF en este dispositivo.',
              );
            }
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadPdf();
    return () => {
      active = false;
    };
  }, [patientId, manager, filename, uri, retryCount]);

  const handleShare = async () => {
    const shareTargetUri = resolvedUri ?? uri;
    if (!shareTargetUri || sharing) return;
    setSharing(true);
    setShareFeedback(null);
    try {
      const res = await reportStorage.shareReportFile(shareTargetUri, 'pdf');
      if (res === 'shared_sheet_opened') {
        AccessibilityInfo.announceForAccessibility('Menú para compartir reporte abierto.');
      }
    } catch (e) {
      setShareFeedback(e instanceof Error ? e.message : 'No se pudo compartir el reporte.');
    } finally {
      setSharing(false);
    }
  };

  const handlePrevPage = () => {
    webViewRef.current?.injectJavaScript('window.prevPage(); true;');
  };

  const handleNextPage = () => {
    webViewRef.current?.injectJavaScript('window.nextPage(); true;');
  };

  const handleZoomIn = () => {
    webViewRef.current?.injectJavaScript('window.zoomIn(); true;');
  };

  const handleZoomOut = () => {
    webViewRef.current?.injectJavaScript('window.zoomOut(); true;');
  };

  const handleResetZoom = () => {
    webViewRef.current?.injectJavaScript('window.resetZoom(); true;');
  };

  const handleWebViewMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'PAGE_UPDATE') {
        if (typeof data.current === 'number') setCurrentPage(data.current);
        if (typeof data.total === 'number') setTotalPages(data.total);
        if (typeof data.zoom === 'number') setZoomPct(Math.round(data.zoom * 100));
      } else if (data.type === 'ERROR') {
        setFileError('No se pudo mostrar el PDF. Vuelve a intentarlo.');
        setPdfBase64(null);
      }
    } catch {
      // Ignorar mensajes no conformes
    }
  };

  // Contenido HTML para el visor integrado de PDF basado en WebView (sin fallback silencioso a HTML)
  const pdfJsHtml = pdfBase64 ? buildPdfJsHtml(pdfBase64) : null;

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

        {/* Botón de compartir independiente */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Compartir reporte PDF con tu médico"
          disabled={sharing}
          onPress={handleShare}
          style={({ pressed }) => [
            styles.toolbarBtn,
            styles.shareBtn,
            pressed && styles.pressed,
            sharing && styles.disabled,
          ]}
        >
          <Feather name="share-2" size={18} color={appTheme.colors.primary} />
          <Text style={styles.shareBtnText}>Compartir</Text>
        </Pressable>
      </View>

      {/* Controles de navegación de página y zoom accesibles en modo visual */}
      {!loading && pdfJsHtml ? (
        <View style={styles.viewerControls}>
          <View style={styles.controlGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Página anterior"
              disabled={currentPage <= 1}
              onPress={handlePrevPage}
              style={({ pressed }) => [
                styles.navBtn,
                pressed && styles.pressed,
                currentPage <= 1 && styles.disabled,
              ]}
            >
              <Feather name="chevron-left" size={18} color={appTheme.colors.text} />
            </Pressable>

            <Text style={styles.pageIndicator}>
              Página {currentPage} de {totalPages}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Página siguiente"
              disabled={currentPage >= totalPages}
              onPress={handleNextPage}
              style={({ pressed }) => [
                styles.navBtn,
                pressed && styles.pressed,
                currentPage >= totalPages && styles.disabled,
              ]}
            >
              <Feather name="chevron-right" size={18} color={appTheme.colors.text} />
            </Pressable>
          </View>

          <View style={styles.controlGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reducir zoom"
              onPress={handleZoomOut}
              style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
            >
              <Feather name="minus" size={16} color={appTheme.colors.text} />
            </Pressable>

            <Text style={styles.zoomIndicator}>{zoomPct}%</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aumentar zoom"
              onPress={handleZoomIn}
              style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
            >
              <Feather name="plus" size={16} color={appTheme.colors.text} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ajustar zoom al 100%"
              onPress={handleResetZoom}
              style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
            >
              <Text style={styles.resetBtnText}>Ajustar</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {shareFeedback ? (
        <View style={styles.feedbackBanner}>
          <Feather name="alert-circle" size={18} color={appTheme.colors.error} />
          <Text style={styles.feedbackText}>{shareFeedback}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={appTheme.colors.primary} />
          <BodyText style={{ marginTop: 12 }}>Cargando informe médico…</BodyText>
        </View>
      ) : (
        /* Modo Visual con visor integrado de PDF basado en WebView */
        <View style={styles.webViewContainer}>
          {pdfJsHtml ? (
            <WebView
              ref={webViewRef}
              originWhitelist={['*']}
              source={{ html: pdfJsHtml, baseUrl: 'file:///android_asset/' }}
              style={styles.webView}
              scalesPageToFit
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              onMessage={handleWebViewMessage}
            />
          ) : (
            <ScrollView
              contentContainerStyle={[styles.centerContainer, { flexGrow: 1, flex: undefined }]}
            >
              <Feather name="alert-triangle" size={48} color={appTheme.colors.warning} />
              <Text style={styles.errorTitle}>
                No se pudo abrir el archivo PDF original en el visor integrado
              </Text>
              <BodyText style={{ marginTop: 8, textAlign: 'center' }}>
                {fileError ??
                  'No fue posible leer o descifrar el documento PDF guardado en este dispositivo.'}
              </BodyText>
              <View style={{ marginTop: 16, width: '100%', gap: theme.spacing.sm }}>
                <VisualButton
                  label="Reintentar lectura"
                  onPress={() => setRetryCount((c) => c + 1)}
                />
              </View>
            </ScrollView>
          )}
        </View>
      )}
    </DocumentScreen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
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
    viewerControls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      backgroundColor: colors.mutedSurface,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: theme.spacing.xs,
    },
    controlGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    navBtn: {
      minWidth: 48,
      minHeight: 48,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resetBtn: {
      paddingHorizontal: 8,
      minHeight: 48,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resetBtnText: {
      fontFamily: 'NunitoSans-Bold',
      fontSize: 12,
      color: colors.primary,
      fontWeight: '700',
    },
    pageIndicator: {
      fontFamily: 'NunitoSans-SemiBold',
      fontSize: 13,
      color: colors.text,
      fontWeight: '600',
      minWidth: 80,
      textAlign: 'center',
    },
    zoomIndicator: {
      fontFamily: 'NunitoSans-SemiBold',
      fontSize: 12,
      color: colors.secondary,
      fontWeight: '600',
      minWidth: 40,
      textAlign: 'center',
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
    errorTitle: {
      fontFamily: 'NunitoSans-Bold',
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginTop: 12,
    },
    webViewContainer: {
      flex: 1,
      borderRadius: theme.radius.sm,
      overflow: 'hidden',
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: '#FFFFFF',
    },
    webView: {
      flex: 1,
      backgroundColor: '#FFFFFF',
    },
    pressed: {
      opacity: 0.7,
    },
    disabled: {
      opacity: 0.4,
    },
  });
}
