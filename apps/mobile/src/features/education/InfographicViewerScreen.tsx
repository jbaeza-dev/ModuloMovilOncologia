import Feather from '@expo/vector-icons/Feather';
import { Asset } from 'expo-asset';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  findNodeHandle,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyText, EmptyState, SectionTitle, VisualButton } from '../../components/Visual';
import type { EducationalResource } from '../../data/local/education/education-types';
import { resourceFileExists } from '../../data/local/files/resource-storage';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { getEducationalCatalogReader } from './educational-catalog-service';

const BUNDLED_ASSETS: Record<string, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  infografia_alimentacion_quimio: require('../../../assets/education/infografia_alimentacion_quimio.png'),
};

const ZOOM_LEVELS = [
  { factor: 1.0, label: '100%' },
  { factor: 1.5, label: '150%' },
  { factor: 2.0, label: '200%' },
  { factor: 3.0, label: '300%' },
] as const;

export function InfographicViewerScreen() {
  const { theme: appTheme } = useAppTheme();
  const { patientId, repository, isClosing } = useLocalData();
  const styles = useStyles();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { recurso } = useLocalSearchParams<{ recurso?: string }>();

  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
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

  const loadResourceData = useCallback(async () => {
    if (!recurso) return null;
    return getEducationalCatalogReader().getResourceById(recurso);
  }, [recurso]);

  const { value: catalogResource, loading: loadingCatalog } = useFocusedValue(
    loadResourceData,
    null,
  );

  const loadLocalCopy = useCallback(async () => {
    if (!repository || !patientId || !recurso) return null;
    return repository.education.getLocalCopy(recurso);
  }, [repository, patientId, recurso]);

  const { value: localCopy, loading: loadingCopy } = useFocusedValue(loadLocalCopy, null);

  const effectiveResource: EducationalResource | null =
    catalogResource ??
    (localCopy
      ? {
          id: recurso ?? localCopy.contentId,
          title: localCopy.titulo ?? localCopy.metadataLocal?.titulo ?? 'Infografía guardada',
          category: 0,
          categoryName: 'Material local',
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

  function handleSetZoom(factor: number, label: string) {
    setZoomFactor(factor);
    const msg = `Nivel de zoom al ${label}`;
    setZoomAnnouncement(msg);
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(msg);
    }
  }

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

  if (loadingCatalog || loadingCopy) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={appTheme.colors.primary} />
          <BodyText style={{ marginTop: 12 }}>Preparando visor de infografía…</BodyText>
        </View>
      </SafeAreaView>
    );
  }

  if (!effectiveResource) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar visor de infografía"
            onPress={handleClose}
            style={styles.closeButton}
          >
            <Feather name="x" size={24} color={appTheme.colors.text} />
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

  const baseImageWidth = Math.max(300, windowWidth - 32);
  const baseImageHeight = Math.max(400, windowHeight - 160);
  const scaledWidth = baseImageWidth * zoomFactor;
  const scaledHeight = baseImageHeight * zoomFactor;

  const accessibleTextContent =
    effectiveResource.textoAccesible ??
    catalogResource?.textoAccesible ??
    localCopy?.metadataLocal?.textoAccesible ??
    effectiveResource.description ??
    'No hay descripción textual disponible para esta infografía.';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      {/* Barra de cabecera con botón de cierre y título */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar visor de infografía"
          onPress={handleClose}
          style={styles.closeButton}
        >
          <Feather name="x" size={24} color={appTheme.colors.text} />
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
      </View>

      {/* Barra de herramientas accesible con controles de zoom y texto alternativo */}
      <View style={styles.toolbar}>
        <View
          style={styles.zoomButtonsContainer}
          accessibilityRole="toolbar"
          accessibilityLabel="Controles de zoom"
        >
          <Text style={styles.toolbarLabel}>Zoom:</Text>
          {ZOOM_LEVELS.map(({ factor, label }) => {
            const isSelected = zoomFactor === factor;
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={`Nivel de ampliación ${label}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => handleSetZoom(factor, label)}
                style={[styles.zoomButton, isSelected && styles.zoomButtonActive]}
              >
                <Text style={[styles.zoomButtonText, isSelected && styles.zoomButtonTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          ref={textButtonRef}
          collapsable={false}
          accessibilityRole="button"
          accessibilityLabel="Leer contenido en texto accesible de la infografía"
          onPress={handleOpenModal}
          style={styles.textAltButton}
        >
          <Feather name="file-text" size={18} color={appTheme.colors.primary} />
          <Text style={styles.textAltButtonText}>Texto accesible</Text>
        </Pressable>
      </View>

      {/* Región viva oculta para lectores de pantalla */}
      {zoomAnnouncement ? (
        <Text accessibilityLiveRegion="polite" style={styles.srOnly}>
          {zoomAnnouncement}
        </Text>
      ) : null}

      {/* Contenedor 2D desplazable con scroll horizontal y vertical cuando la imagen está ampliada */}
      <View style={styles.viewerFrame}>
        {imageError ? (
          <View style={styles.errorContainer}>
            <Feather name="alert-triangle" size={32} color={appTheme.colors.error} />
            <Text style={styles.errorTitle}>No se pudo cargar la imagen</Text>
            <BodyText style={{ textAlign: 'center' }}>
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
            <Feather name="image" size={32} color={appTheme.colors.secondary} />
            <Text style={styles.errorTitle}>Imagen no disponible</Text>
            <BodyText style={{ textAlign: 'center' }}>
              No se encontró una copia local ni recurso empaquetado para visualizar.
            </BodyText>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={true}
            contentContainerStyle={styles.horizontalScrollContent}
            style={styles.fullSize}
          >
            <ScrollView
              showsVerticalScrollIndicator={true}
              contentContainerStyle={styles.verticalScrollContent}
              style={styles.fullSize}
            >
              <Image
                key={`viewer-${resolvedImageUri}-${retryNonce}`}
                source={{ uri: resolvedImageUri }}
                style={{
                  width: scaledWidth,
                  height: scaledHeight,
                }}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel={`Infografía ampliada: ${effectiveResource.title}`}
                onLoad={() => {
                  setImageLoaded(true);
                  setImageError(false);
                }}
                onError={() => {
                  setImageLoaded(false);
                  setImageError(true);
                }}
              />
              {!imageLoaded && !imageError ? (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color={appTheme.colors.primary} />
                  <BodyText style={{ marginTop: 8 }}>Cargando imagen…</BodyText>
                </View>
              ) : null}
            </ScrollView>
          </ScrollView>
        )}
      </View>

      {/* Modal accesible para lectura de texto alternativo sin conexión */}
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
    safeArea: {
      flex: 1,
      backgroundColor: appTheme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: appTheme.colors.border,
      backgroundColor: appTheme.colors.surface,
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
      color: appTheme.colors.text,
    },
    headerTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: appTheme.colors.text,
    },
    fullSize: {
      flex: 1,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    toolbar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: appTheme.colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: theme.radius.sm,
      gap: 8,
      marginHorizontal: 8,
      marginTop: 8,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
    },
    zoomButtonsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    toolbarLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: appTheme.colors.text,
      marginRight: 2,
    },
    zoomButton: {
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 10,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 9999,
      backgroundColor: appTheme.colors.background,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
    },
    zoomButtonActive: {
      backgroundColor: appTheme.colors.primary,
      borderColor: appTheme.colors.primary,
    },
    zoomButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: appTheme.colors.text,
    },
    zoomButtonTextActive: {
      color: appTheme.colors.onPrimary,
    },
    textAltButton: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: 9999,
      backgroundColor: appTheme.colors.background,
      borderWidth: 1,
      borderColor: appTheme.colors.primary,
      gap: 6,
    },
    textAltButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: appTheme.colors.primary,
    },
    viewerFrame: {
      flex: 1,
      backgroundColor: '#1a1a1a',
      borderRadius: theme.radius.sm,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: appTheme.colors.border,
      marginHorizontal: 8,
      marginBottom: 8,
    },
    horizontalScrollContent: {
      minWidth: '100%',
      justifyContent: 'center',
      alignItems: 'center',
    },
    verticalScrollContent: {
      minHeight: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    loadingOverlay: {
      position: 'absolute',
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      gap: 12,
      backgroundColor: appTheme.colors.surface,
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
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
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
    },
    modalCloseIcon: {
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
