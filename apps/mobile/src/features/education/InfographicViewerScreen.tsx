import { verifiedLocalImageCopy } from './infographic-storage-service';
import { AppIcon as Feather } from '../../components/AppIcon';
import { Asset } from 'expo-asset';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyText, EmptyState, SectionTitle, VisualButton } from '../../components/Visual';
import type { EducationalResource } from '../../data/local/education/education-types';
import { resourceFileExists } from '../../data/local/files/resource-storage';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import {
  EducationContentRevisionContext,
  EducationStatusRevisionContext,
} from '../../providers/QueryRevision';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { useEducationalCatalog } from './use-educational-catalog';
import { ZoomableImageView, type ZoomableImageViewRef } from './ZoomableImageView';

const BUNDLED_ASSETS: Record<string, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  infografia_alimentacion_quimio: require('../../../assets/education/infografia_alimentacion_quimio.png'),
};

export function InfographicViewerScreen() {
  const catalogReader = useEducationalCatalog();
  const { theme: appTheme } = useAppTheme();
  const { patientId, repository, isClosing } = useLocalData();
  const styles = useStyles();
  const { recurso } = useLocalSearchParams<{ recurso?: string }>();

  const zoomableRef = useRef<ZoomableImageViewRef>(null);

  const [currentScale, setCurrentScale] = useState<number>(1.0);
  const [showZoomOptions, setShowZoomOptions] = useState(false);
  const [zoomAnnouncement, setZoomAnnouncement] = useState<string>('');
  const [isTextModalVisible, setIsTextModalVisible] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const textButtonRef = useRef<View>(null);
  const modalTitleRef = useRef<View>(null);

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/educacion');
    }
  }, []);

  // Guardia de pérdida de sesión o cierre
  useEffect(() => {
    if (!patientId || isClosing) {
      handleClose();
    }
  }, [patientId, isClosing, handleClose]);

  // Manejo de botón Atrás nativo de Android y gestos del sistema
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isTextModalVisible) {
        setIsTextModalVisible(false);
      } else {
        handleClose();
      }
      // Both actions consume Back; never close the reader and leave the screen together.
      return true;
    });
    return () => subscription.remove();
  }, [isTextModalVisible, handleClose]);

  const loadResourceData = useCallback(async () => {
    if (!recurso) return null;
    return catalogReader.getResourceById(recurso);
  }, [recurso, catalogReader]);

  const { value: catalogResource, loading: loadingCatalog } = useFocusedValue(
    loadResourceData,
    null,
    {
      queryKey: `${patientId ?? 'default'}:education:infographic-catalog:${recurso ?? 'none'}`,
      context: EducationContentRevisionContext,
    },
  );

  const loadLocalCopy = useCallback(async () => {
    if (!repository || !patientId || !recurso) return null;
    const copy = await repository.education.getLocalCopy(recurso);
    return copy ? verifiedLocalImageCopy(copy, patientId) : null;
  }, [repository, patientId, recurso]);

  const {
    value: localCopy,
    loading: loadingCopy,
    refresh: refreshCopy,
  } = useFocusedValue(loadLocalCopy, null, {
    queryKey: `${patientId ?? 'default'}:education:infographic-copy:${recurso ?? 'none'}`,
    context: EducationStatusRevisionContext,
  });

  // Marcar automáticamente como visualizada al cargar la infografía
  useEffect(() => {
    if (repository && recurso && (imageLoaded || localCopy)) {
      void repository.education
        .markCopyViewed(recurso)
        .then(() => refreshCopy())
        .catch(() => {});
    }
  }, [repository, recurso, imageLoaded, Boolean(localCopy), refreshCopy]);

  const hasOlderCopy = Boolean(
    localCopy &&
    catalogResource &&
    localCopy.metadataLocal?.versionOrigen !== catalogResource.version,
  );
  const effectiveResource: EducationalResource | null =
    (hasOlderCopy ? null : catalogResource) ??
    (localCopy
      ? {
          id: recurso ?? localCopy.contentId,
          title: localCopy.titulo ?? localCopy.metadataLocal?.titulo ?? 'Infografía guardada',
          category: 0,
          categoryName: 'Material guardado',
          description:
            localCopy.descripcion ??
            localCopy.metadataLocal?.descripcion ??
            'Infografía disponible para lectura sin conexión.',
          type: 'infografia',
          version:
            localCopy.metadataLocal?.versionOrigen ??
            localCopy.metadataLocal?.sha256?.slice(0, 8) ??
            'local',
          textoAccesible: localCopy.metadataLocal?.textoAccesible,
        }
      : null);

  // Determinar la URI o fuente de la imagen
  const [resolvedImageUri, setResolvedImageUri] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function resolveSource() {
      // 1. Prioridad: copia local descargada si existe físicamente
      if (patientId && localCopy?.rutaRelativa) {
        if (localCopy.estado === 'error') {
          if (active) {
            setResolvedImageUri(null);
            setImageError(true);
          }
          return;
        }
        const fileOk = resourceFileExists(patientId, localCopy.contentId, localCopy.rutaRelativa);
        if (fileOk) {
          if (active) setResolvedImageUri(localCopy.rutaRelativa);
          return;
        }
      }

      // 2. Asset empaquetado del catálogo
      if (catalogResource?.asset?.type === 'bundled') {
        const assetModule = BUNDLED_ASSETS[catalogResource.asset.assetKey];
        if (assetModule) {
          try {
            const [loaded] = await Asset.loadAsync(assetModule);
            const uri = loaded?.localUri ?? loaded?.uri;
            if (active && uri) {
              setResolvedImageUri(uri);
              return;
            }
          } catch {
            // Ignorar fallo al resolver asset empaquetado
          }
        }
      }

      // 3. URL remota
      if (catalogResource?.asset?.type === 'remote') {
        if (active) setResolvedImageUri(catalogResource.asset.url);
        return;
      }

      if (active) setResolvedImageUri(null);
    }

    void resolveSource();

    return () => {
      active = false;
    };
  }, [catalogResource, localCopy, patientId, retryNonce]);

  function handleOpenModal() {
    setIsTextModalVisible(true);
    setTimeout(() => {
      if (modalTitleRef.current) {
        const reactTag = findNodeHandle(modalTitleRef.current);
        if (reactTag) {
          AccessibilityInfo.setAccessibilityFocus(reactTag);
        }
      }
    }, 100);
  }

  function handleCloseModal() {
    setIsTextModalVisible(false);
    setTimeout(() => {
      if (textButtonRef.current) {
        const reactTag = findNodeHandle(textButtonRef.current);
        if (reactTag) {
          AccessibilityInfo.setAccessibilityFocus(reactTag);
        }
      }
    }, 100);
  }

  function handleZoomIn() {
    zoomableRef.current?.zoomIn();
  }

  function handleZoomOut() {
    zoomableRef.current?.zoomOut();
  }

  function handleResetZoom() {
    zoomableRef.current?.resetZoom();
  }

  if (loadingCatalog || loadingCopy) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <BodyText style={{ marginTop: 12, color: '#FFFFFF' }}>
            Preparando visor de infografía…
          </BodyText>
        </View>
      </SafeAreaView>
    );
  }

  if (!effectiveResource) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.headerBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar visor de infografía"
            onPress={handleClose}
            style={styles.closeButton}
          >
            <Feather name="x" size={24} color="#FFFFFF" />
            <Text style={styles.closeButtonText}>Cerrar</Text>
          </Pressable>
        </View>
        <EmptyState
          icon="alert-circle"
          title="Infografía no disponible"
          description="No se encontró el material educativo solicitado."
        />
        <View style={{ padding: 16 }}>
          <VisualButton label="Volver a educación" secondary onPress={handleClose} />
        </View>
      </SafeAreaView>
    );
  }

  const accessibleTextContent =
    effectiveResource.textoAccesible ??
    localCopy?.metadataLocal?.textoAccesible ??
    effectiveResource.description ??
    'No hay descripción textual disponible para esta infografía.';

  return (
    <SafeAreaView style={styles.rootContainer}>
      {/* Controles fuera del área de imagen para no ocultar el título del original */}
      <View style={styles.headerSafeArea}>
        <View style={styles.headerBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar visor de infografía"
            onPress={handleClose}
            style={styles.closeButton}
          >
            <Feather name="x" size={24} color="#FFFFFF" />
            <Text style={styles.closeButtonText}>Cerrar</Text>
          </Pressable>

          <Text
            accessibilityRole="header"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.headerTitle}
          >
            {effectiveResource.title}
          </Text>

          <View style={styles.headerActions}>
            <Pressable
              ref={textButtonRef}
              collapsable={false}
              accessibilityRole="button"
              accessibilityLabel="Leer contenido en texto accesible de la infografía"
              onPress={handleOpenModal}
              style={styles.headerActionButton}
            >
              <Feather name="file-text" size={18} color="#FFFFFF" />
              <Text style={styles.headerActionButtonText}>Texto accesible</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Opciones accesibles de zoom"
              accessibilityState={{ expanded: showZoomOptions }}
              onPress={() => setShowZoomOptions((prev) => !prev)}
              style={[
                styles.headerActionButton,
                showZoomOptions && styles.headerActionButtonActive,
              ]}
            >
              <Feather name="zoom-in" size={18} color="#FFFFFF" />
              <Text style={styles.headerActionButtonText}>Zoom</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* 1. Visor interactivo principal a pantalla completa con fondo oscuro */}
      <View style={styles.viewerFrame}>
        {localCopy &&
        catalogResource &&
        localCopy.metadataLocal?.versionOrigen !== catalogResource.version ? (
          <BodyText>
            Copia de una revisión anterior; hay una nueva publicación para descargar.
          </BodyText>
        ) : null}
        {imageError ? (
          <View style={styles.errorContainer}>
            <Feather name="alert-triangle" size={36} color={appTheme.colors.error} />
            <Text style={styles.errorTitle}>No se pudo cargar la imagen</Text>
            <BodyText style={{ textAlign: 'center', color: '#CCCCCC' }}>
              El archivo de la imagen no pudo ser renderizado en el dispositivo.
            </BodyText>
            <VisualButton
              label="Reintentar visualización"
              secondary
              onPress={() => {
                setImageError(false);
                setImageLoaded(false);
                setRetryNonce((n) => n + 1);
              }}
            />
          </View>
        ) : !resolvedImageUri ? (
          <View style={styles.errorContainer}>
            <Feather name="image" size={36} color="#888888" />
            <Text style={styles.errorTitle}>Imagen no disponible</Text>
            <BodyText style={{ textAlign: 'center', color: '#CCCCCC' }}>
              Este contenido aún no está guardado. Descárgalo con internet.
            </BodyText>
          </View>
        ) : (
          <ZoomableImageView
            ref={zoomableRef}
            sourceUri={resolvedImageUri}
            accessibilityLabel={`Infografía a pantalla completa: ${effectiveResource.title}. Toque dos veces o separe dos dedos para ampliar.`}
            onLoad={() => {
              setImageLoaded(true);
              setImageError(false);
            }}
            onError={() => {
              setImageLoaded(false);
              setImageError(true);
            }}
            onScaleChange={setCurrentScale}
            onZoomAnnouncement={setZoomAnnouncement}
          />
        )}

        {!imageLoaded && !imageError && resolvedImageUri ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <BodyText style={{ marginTop: 8, color: '#FFFFFF' }}>Cargando imagen…</BodyText>
          </View>
        ) : null}
      </View>

      {/* Controles fuera de la imagen y del área de navegación del sistema. */}
      {showZoomOptions ? (
        <View
          style={styles.floatingZoomContainer}
          accessibilityRole="toolbar"
          accessibilityLabel="Controles accesibles de ampliación"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reducir zoom"
            onPress={handleZoomOut}
            style={styles.floatingZoomButton}
          >
            <Feather name="minus" size={20} color="#FFFFFF" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Restablecer tamaño normal"
            onPress={handleResetZoom}
            style={styles.floatingZoomResetButton}
          >
            <Text style={styles.floatingZoomResetText}>{Math.round(currentScale * 100)}%</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aumentar zoom"
            onPress={handleZoomIn}
            style={styles.floatingZoomButton}
          >
            <Feather name="plus" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}

      {/* Región viva para lectores de pantalla TalkBack */}
      {zoomAnnouncement ? (
        <Text accessibilityLiveRegion="polite" style={styles.srOnly}>
          {zoomAnnouncement}
        </Text>
      ) : null}

      {/* 4. Modal accesible para lectura de texto alternativo sin conexión */}
      <Modal
        visible={isTextModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseModal}
        accessibilityViewIsModal={true}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View
                ref={modalTitleRef}
                style={styles.modalTitle}
                collapsable={false}
                accessible={true}
                accessibilityRole="header"
              >
                <SectionTitle>Texto alternativo accesible</SectionTitle>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cerrar texto accesible"
                onPress={handleCloseModal}
                style={styles.modalCloseIcon}
              >
                <Feather name="x" size={24} color={appTheme.colors.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalScroll}>
              <BodyText style={styles.modalBodyText}>{accessibleTextContent}</BodyText>
            </ScrollView>

            <View style={styles.modalFooter}>
              <VisualButton label="Cerrar lectura" onPress={handleCloseModal} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();

  return StyleSheet.create({
    rootContainer: {
      flex: 1,
      backgroundColor: '#000000',
    },
    safeArea: {
      flex: 1,
      backgroundColor: '#000000',
    },
    viewerFrame: {
      flex: 1,
      backgroundColor: '#000000',
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerSafeArea: { backgroundColor: '#141414' },
    headerBar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 8,
    },
    closeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 8,
      gap: 4,
      borderRadius: theme.radius.sm,
    },
    closeButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    headerTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: '#FFFFFF',
      marginHorizontal: 4,
    },
    headerActions: {
      width: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    headerActionButton: {
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 10,
      borderRadius: 9999,
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      gap: 6,
    },
    headerActionButtonActive: {
      backgroundColor: appTheme.colors.primary,
    },
    headerActionButtonText: {
      flexShrink: 1,
      fontSize: 13,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    floatingZoomContainer: {
      alignSelf: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      backgroundColor: 'rgba(20, 20, 20, 0.92)',
      borderRadius: 9999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.25)',
      marginVertical: 4,
      gap: 4,
    },
    floatingZoomButton: {
      minWidth: 48,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 9999,
    },
    floatingZoomResetButton: {
      minHeight: 48,
      paddingHorizontal: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    floatingZoomResetText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    loadingOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 5,
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      gap: 12,
      backgroundColor: '#121212',
    },
    errorTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: appTheme.colors.error,
    },
    srOnly: {
      position: 'absolute',
      width: 1,
      height: 1,
      opacity: 0,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    modalCard: {
      width: '100%',
      maxWidth: 540,
      maxHeight: '80%',
      backgroundColor: appTheme.colors.surface,
      borderRadius: theme.radius.md,
      padding: 20,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
      gap: 8,
    },
    modalTitle: { flex: 1 },
    modalCloseIcon: {
      flexShrink: 0,
      minWidth: 48,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalScroll: {
      marginVertical: 12,
    },
    modalBodyText: {
      fontSize: 16,
      lineHeight: 24,
      color: appTheme.colors.text,
    },
    modalFooter: {
      marginTop: 8,
    },
  });
}
