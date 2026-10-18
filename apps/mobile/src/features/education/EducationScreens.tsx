import Feather from '@expo/vector-icons/Feather';
import * as Network from 'expo-network';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import type {
  EducationalInteraction,
  EducationalLocalCopy,
  EducationalResource,
} from '../../data/local/education/education-types';
import {
  readResourceFile,
  reconcileResourceCopies,
  resourceFileExists,
} from '../../data/local/files/resource-storage';
import { formatDate } from '../../data/local/repository';
import { useFocusedList, useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import {
  getEducationalCatalogReader,
  type EducationalCategory,
  type EducationalFormatFilter,
} from './educational-catalog-service';
import { getCategoryByIdOrSlug } from './educational-categories';
import {
  downloadAndSaveInfographic,
  removeLocalInfographicCopy,
} from './infographic-storage-service';
import { useBulkInfographicDownload } from './use-bulk-infographic-download';
import { executeYouTubeLaunch } from './youtube-launcher';

export { downloadAndSaveInfographic, removeLocalInfographicCopy };

export function EducationScreen() {
  const { theme: appTheme } = useAppTheme();
  const { repository, patientId, runSave } = useLocalData();
  const styles = useStyles();
  const params = useLocalSearchParams<{ filtro?: string }>();
  const isOfflineFilter = params.filtro === 'offline';

  // Modal para acciones individuales en biblioteca sin conexión
  const [infoResource, setInfoResource] = useState<EducationalResource | null>(null);
  const [modalActionBusy, setModalActionBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadCopies = useCallback(async (): Promise<EducationalLocalCopy[]> => {
    if (!repository || !patientId) return [];
    return repository.education.listLocalCopies();
  }, [repository, patientId]);

  const { items: copies, refresh: refreshCopies } = useFocusedList(loadCopies);

  const loadCategories = useCallback(async (): Promise<EducationalCategory[]> => {
    return getEducationalCatalogReader().getCategories();
  }, []);

  const { items: categories } = useFocusedList(loadCategories);

  const {
    isDownloading,
    isCancelling,
    progress,
    summaryMessage,
    error: bulkError,
    hasPending,
    startDownload,
    cancelDownload,
    clearSummary,
  } = useBulkInfographicDownload(refreshCopies);

  // Copias físicas válidas existentes en disco
  const physicallyPresentCopies = useMemo(() => {
    if (!patientId) return [];
    return copies.filter(
      (c) =>
        c.rutaRelativa &&
        resourceFileExists(patientId, c.contentId, c.rutaRelativa) &&
        c.estado !== 'error',
    );
  }, [copies, patientId]);

  // Acciones individuales en modal de biblioteca sin conexión
  async function handleDeleteFromModal(
    targetResource: EducationalResource,
    copy?: EducationalLocalCopy | null,
  ) {
    if (!repository || !patientId || modalActionBusy) return;
    setModalActionBusy(true);
    setModalError(null);
    try {
      await runSave(async () => {
        await removeLocalInfographicCopy({
          contentId: targetResource.id,
          patientId,
          repository,
          localCopy: copy,
        });
      });
      refreshCopies();
      setInfoResource(null);
    } catch (err) {
      setModalError(
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar el archivo local en el dispositivo.',
      );
    } finally {
      setModalActionBusy(false);
    }
  }

  async function handleDeclareReviewedFromModal(targetResource: EducationalResource) {
    if (!repository || modalActionBusy) return;
    setModalActionBusy(true);
    setModalError(null);
    try {
      await runSave(async () => {
        await repository.education.declareCopyReviewed(targetResource.id);
      });
      refreshCopies();
    } catch {
      setModalError('No se pudo registrar la revisión del material.');
    } finally {
      setModalActionBusy(false);
    }
  }

  // Vista unificada de biblioteca sin conexión (/educacion?filtro=offline)
  if (isOfflineFilter) {
    return (
      <Screen isRoot title="Mis copias guardadas">
        <DemoBadge />
        <BodyText>
          Materiales guardados en este dispositivo para lectura y consulta sin conexión.
        </BodyText>

        {/* Barra de control para salir del filtro sin conexión */}
        <View style={styles.offlineFilterHeader}>
          <View style={styles.activeFilterChip}>
            <Feather name="check" size={16} color={appTheme.colors.onPrimary} />
            <Text style={styles.activeFilterChipText}>Filtro: Sin conexión</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ver todas las categorías"
            onPress={() => router.navigate('/educacion')}
            style={styles.exitFilterButton}
          >
            <Text style={styles.exitFilterButtonText}>Ver categorías</Text>
          </Pressable>
        </View>

        {physicallyPresentCopies.length === 0 ? (
          <EmptyState
            icon="folder"
            title="Sin copias guardadas"
            description="Aún no has guardado infografías en este dispositivo."
          />
        ) : (
          physicallyPresentCopies.map((copy) => {
            const formatChipLabel = 'Infografía · Disponible sin internet';
            const isReviewed = Boolean(copy.revisionDeclarada);
            const reviewedDate = copy.revisionDeclaradaEn
              ? formatDate(copy.revisionDeclaradaEn)
              : null;
            const resourceItem: EducationalResource = {
              id: copy.contentId,
              title: copy.titulo ?? copy.metadataLocal?.titulo ?? 'Infografía guardada',
              category: 0,
              categoryName: 'Material guardado',
              description:
                copy.descripcion ??
                copy.metadataLocal?.descripcion ??
                'Infografía disponible sin conexión.',
              type: 'infografia',
              version: copy.metadataLocal?.versionOrigen ?? 'local',
              textoAccesible: copy.metadataLocal?.textoAccesible,
            };

            return (
              <View key={copy.contentId} style={styles.cardContainer}>
                {/* 1 toque abre directamente el visor a pantalla completa */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${resourceItem.title}, ${formatChipLabel}`}
                  onPress={() =>
                    router.push('/visor-infografia?recurso=' + encodeURIComponent(copy.contentId))
                  }
                  style={styles.cardMainPressable}
                >
                  <Feather name="image" size={28} color={appTheme.colors.primary} />
                  <View style={styles.cardContent}>
                    <Text style={styles.heading}>{resourceItem.title}</Text>
                    <View style={styles.chipsRow}>
                      <StatusPill>{formatChipLabel}</StatusPill>
                      {isReviewed && reviewedDate ? (
                        <StatusPill>{`Revisado el ${reviewedDate}`}</StatusPill>
                      ) : null}
                    </View>
                  </View>
                </Pressable>

                {/* Botón aislado para información y acciones individuales */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Información de ${resourceItem.title}`}
                  onPress={() => {
                    setModalError(null);
                    setInfoResource(resourceItem);
                  }}
                  style={styles.cardInfoButton}
                >
                  <Feather name="info" size={20} color={appTheme.colors.primary} />
                  <Text style={styles.cardInfoButtonText}>Info</Text>
                </Pressable>
              </View>
            );
          })
        )}

        {/* Modal de información y acciones individuales para la biblioteca sin conexión */}
        {infoResource ? (
          <Modal
            visible={Boolean(infoResource)}
            transparent={true}
            animationType="fade"
            onRequestClose={() => {
              setInfoResource(null);
              setModalError(null);
            }}
            accessibilityViewIsModal={true}
          >
            {(() => {
              const currentCopy = physicallyPresentCopies.find(
                (c) => c.contentId === infoResource.id,
              );
              return (
                <View style={styles.modalOverlay}>
                  <View style={styles.modalCard}>
                    <View style={styles.modalHeader}>
                      <View style={{ flex: 1 }}>
                        <SectionTitle>{infoResource.title}</SectionTitle>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cerrar información"
                        onPress={() => {
                          setInfoResource(null);
                          setModalError(null);
                        }}
                        style={styles.modalCloseIcon}
                      >
                        <Feather name="x" size={24} color={appTheme.colors.text} />
                      </Pressable>
                    </View>

                    <ScrollView style={styles.modalScroll} contentContainerStyle={{ gap: 12 }}>
                      <BodyText>{infoResource.description}</BodyText>
                      <View style={styles.noticeBox}>
                        <StatusPill>
                          {currentCopy?.revisionDeclarada
                            ? `Material revisado el ${currentCopy.revisionDeclaradaEn ? formatDate(currentCopy.revisionDeclaradaEn) : 'sí'}`
                            : 'Guardado en este dispositivo'}
                        </StatusPill>
                      </View>
                      {modalError ? (
                        <Text accessibilityRole="alert" style={styles.errorText}>
                          {modalError}
                        </Text>
                      ) : null}
                    </ScrollView>

                    <View style={styles.modalFooter}>
                      <VisualButton
                        label="Ver en pantalla completa"
                        disabled={modalActionBusy}
                        onPress={() => {
                          setInfoResource(null);
                          router.push(
                            '/visor-infografia?recurso=' + encodeURIComponent(infoResource.id),
                          );
                        }}
                      />
                      {!currentCopy?.revisionDeclarada ? (
                        <VisualButton
                          label={modalActionBusy ? 'Confirmando…' : 'Marcar como visto'}
                          disabled={modalActionBusy}
                          onPress={() => void handleDeclareReviewedFromModal(infoResource)}
                        />
                      ) : null}
                      <VisualButton
                        label={modalActionBusy ? 'Quitando…' : 'Quitar descarga'}
                        secondary
                        disabled={modalActionBusy}
                        onPress={() => void handleDeleteFromModal(infoResource, currentCopy)}
                      />
                      <VisualButton
                        label="Cerrar"
                        secondary
                        onPress={() => {
                          setInfoResource(null);
                          setModalError(null);
                        }}
                      />
                    </View>
                  </View>
                </View>
              );
            })()}
          </Modal>
        ) : null}
      </Screen>
    );
  }

  // Vista principal de biblioteca (/educacion)
  return (
    <Screen isRoot title="Contenido educativo">
      <DemoBadge />
      <BodyText>
        Biblioteca multimedia sobre quimioterapia: guías e infografías descargables y videos
        educativos online.
      </BodyText>

      {/* Banner de progreso o estado de descarga masiva */}
      {isDownloading ? (
        <View style={styles.downloadBanner} accessibilityLiveRegion="polite">
          <View style={styles.downloadBannerHeader}>
            <ActivityIndicator size="small" color={appTheme.colors.primary} />
            <Text style={styles.downloadBannerTitle}>
              {isCancelling
                ? 'Cancelando…'
                : progress
                  ? `Guardando ${progress.current} de ${progress.total}… (${progress.percent}%)`
                  : 'Iniciando descarga…'}
            </Text>
          </View>
          {progress ? (
            <Text style={styles.downloadBannerSubtitle} numberOfLines={1}>
              {progress.currentTitle}
            </Text>
          ) : null}
          <VisualButton
            label={isCancelling ? 'Cancelando…' : 'Cancelar descarga'}
            secondary
            disabled={isCancelling}
            onPress={cancelDownload}
          />
        </View>
      ) : null}

      {bulkError ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Feather name="alert-circle" size={20} color={appTheme.colors.error} />
          <Text style={styles.errorBannerText}>{bulkError}</Text>
        </View>
      ) : null}

      {!isDownloading && summaryMessage ? (
        <View style={styles.summaryBanner} accessibilityLiveRegion="polite">
          <View style={styles.summaryBannerContentRow}>
            <Feather
              name={hasPending ? 'alert-triangle' : 'check-circle'}
              size={20}
              color={hasPending ? appTheme.colors.warning : appTheme.colors.primary}
            />
            <Text style={styles.summaryBannerText}>{summaryMessage}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar aviso"
              onPress={clearSummary}
              style={styles.summaryCloseIcon}
            >
              <Feather name="x" size={18} color={appTheme.colors.text} />
            </Pressable>
          </View>
          {hasPending ? (
            <View style={styles.summaryRetryContainer}>
              <VisualButton
                label="Reintentar pendientes"
                secondary
                onPress={() => void startDownload()}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {!isDownloading && !summaryMessage ? (
        <View style={styles.bulkDownloadCard}>
          <VisualButton
            label="Guardar todas las infografías sin conexión"
            secondary
            onPress={() => void startDownload()}
          />
        </View>
      ) : null}

      {/* Acceso a copias locales descargadas unificadas */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ver mis copias guardadas sin conexión"
        onPress={() => router.navigate('/educacion?filtro=offline')}
        style={[styles.row, styles.copiesCard]}
      >
        <Feather name="folder" size={28} color={appTheme.colors.primary} />
        <View style={styles.copy}>
          <Text style={styles.heading}>Mis copias guardadas</Text>
          <BodyText>
            {physicallyPresentCopies.length === 1
              ? '1 material disponible sin conexión'
              : `${physicallyPresentCopies.length} materiales disponibles sin conexión`}
          </BodyText>
        </View>
        <Feather name="chevron-right" size={22} color={appTheme.colors.text} />
      </Pressable>

      {/* Categorías educativas dinámicas */}
      {categories.map((category) => (
        <Pressable
          key={category.id}
          accessibilityRole="button"
          accessibilityLabel={category.title}
          onPress={() => router.navigate('/educacion/categoria?categoria=' + String(category.id))}
          style={styles.row}
        >
          <Feather name={category.icon} size={28} color={appTheme.colors.primary} />
          <View style={styles.copy}>
            <Text style={styles.heading}>{category.title}</Text>
            <BodyText>{category.countLabel}</BodyText>
          </View>
          <Feather name="chevron-right" size={22} color={appTheme.colors.text} />
        </Pressable>
      ))}
    </Screen>
  );
}

export function EducationCategoryScreen() {
  const { theme: appTheme } = useAppTheme();
  const { repository, patientId, runSave, database, manager } = useLocalData();
  const styles = useStyles();

  const [formatFilter, setFormatFilter] = useState<EducationalFormatFilter>('all');
  const [infoResource, setInfoResource] = useState<EducationalResource | null>(null);
  const [modalActionBusy, setModalActionBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const { categoria } = useLocalSearchParams<{ categoria?: string }>();
  const resolvedCategory = useMemo(() => getCategoryByIdOrSlug(categoria), [categoria]);
  const categoryIndex = resolvedCategory.id;

  const loadData = useCallback(async () => {
    const reader = getEducationalCatalogReader();
    const [categories, resources, copies, interactions] = await Promise.all([
      reader.getCategories(),
      reader.getResourcesByCategory(categoryIndex, formatFilter),
      repository && patientId ? repository.education.listLocalCopies() : Promise.resolve([]),
      repository && patientId && typeof repository.education.listInteractions === 'function'
        ? repository.education.listInteractions()
        : Promise.resolve([]),
    ]);

    if (repository && patientId) {
      await reconcileResourceCopies(patientId, repository).catch(() => undefined);
    }

    const currentCategory = categories.find((c) => c.id === categoryIndex) ?? {
      id: resolvedCategory.id,
      title: resolvedCategory.title,
      icon: resolvedCategory.icon,
      count: 0,
      countLabel: '0 contenidos',
    };
    return { currentCategory, resources, copies, interactions };
  }, [categoryIndex, formatFilter, repository, patientId, resolvedCategory]);

  const {
    value,
    loading: loadingData,
    error: dataError,
    refresh: refreshData,
  } = useFocusedValue<{
    currentCategory?: EducationalCategory;
    resources: EducationalResource[];
    copies: EducationalLocalCopy[];
    interactions: EducationalInteraction[];
  }>(loadData, {
    currentCategory: undefined,
    resources: [],
    copies: [],
    interactions: [],
  });

  const copyMap = new Map((value?.copies ?? []).map((c) => [c.contentId, c]));
  const interactionMap = new Map((value?.interactions ?? []).map((i) => [i.contentId, i]));

  // Acceso directo con 1 toque según tipo de recurso
  async function handleDirectOpen(resource: EducationalResource) {
    if (resource.type === 'video') {
      const res = await executeYouTubeLaunch({
        resourceId: resource.id,
        youtubeVideoId: resource.youtubeVideoId,
        version: resource.version,
        patientId,
        repository,
        runSave,
        expectedPatientId: patientId,
        getCurrentPatientId: () => manager.getPatientId(),
        expectedEpoch: manager.getContextEpoch(),
        getCurrentEpoch: () => manager.getContextEpoch(),
      });
      if (!res.success && res.error) {
        Alert.alert('Video online', res.error);
      }
      refreshData();
    } else if (resource.type === 'infografia') {
      router.push('/visor-infografia?recurso=' + encodeURIComponent(resource.id));
    } else if (resource.type === 'guia') {
      router.push('/educacion/recurso?recurso=' + encodeURIComponent(resource.id));
    }
  }

  // Acciones individuales desde el modal Información
  async function handleSaveFromModal(targetResource: EducationalResource) {
    if (!repository || !patientId || !database || modalActionBusy) return;
    setModalActionBusy(true);
    setModalError(null);
    try {
      await runSave(async () => {
        const copy = copyMap.get(targetResource.id);
        await downloadAndSaveInfographic({
          resource: targetResource,
          patientId,
          repository,
          database,
          localCopy: copy,
        });
      });
      refreshData();
    } catch (err) {
      setModalError(
        err instanceof Error
          ? err.message
          : 'No se pudo guardar la infografía sin conexión en el dispositivo.',
      );
    } finally {
      setModalActionBusy(false);
    }
  }

  async function handleDeleteFromModal(
    targetResource: EducationalResource,
    copy?: EducationalLocalCopy | null,
  ) {
    if (!repository || !patientId || modalActionBusy) return;
    setModalActionBusy(true);
    setModalError(null);
    try {
      await runSave(async () => {
        await removeLocalInfographicCopy({
          contentId: targetResource.id,
          patientId,
          repository,
          localCopy: copy,
        });
      });
      refreshData();
    } catch (err) {
      setModalError(
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar el archivo local en el dispositivo.',
      );
    } finally {
      setModalActionBusy(false);
    }
  }

  async function handleDeclareCopyReviewedFromModal(targetResource: EducationalResource) {
    if (!repository || modalActionBusy) return;
    setModalActionBusy(true);
    setModalError(null);
    try {
      await runSave(async () => {
        await repository.education.declareCopyReviewed(targetResource.id);
      });
      refreshData();
    } catch {
      setModalError('No se pudo registrar la revisión de la copia local.');
    } finally {
      setModalActionBusy(false);
    }
  }

  async function handleDeclareVideoReviewedFromModal(targetResource: EducationalResource) {
    if (!repository || modalActionBusy || !targetResource.youtubeVideoId) return;
    setModalActionBusy(true);
    setModalError(null);
    try {
      await runSave(async () => {
        const res = await repository.education.declareYouTubeReviewed({
          contentId: targetResource.id,
          youtubeVideoId: targetResource.youtubeVideoId!,
          versionOrigen: targetResource.version,
        });
        if (!res.updated) {
          throw new Error('No se pudo confirmar la revisión del video.');
        }
      });
      refreshData();
    } catch {
      setModalError('No se pudo confirmar la revisión del video.');
    } finally {
      setModalActionBusy(false);
    }
  }

  return (
    <Screen title={value?.currentCategory?.title ?? resolvedCategory.title}>
      <DemoBadge />
      <BodyText>Recursos y guías diseñadas para acompañarte en tu cuidado diario.</BodyText>

      {/* Selector de formato: Todos, Videos, Infografías */}
      <View
        style={styles.filterRow}
        accessibilityRole="toolbar"
        accessibilityLabel="Filtro de formato"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Todos los formatos"
          accessibilityState={{ selected: formatFilter === 'all' }}
          style={[styles.filterChip, formatFilter === 'all' && styles.filterChipActive]}
          onPress={() => setFormatFilter('all')}
        >
          <Text
            style={[styles.filterChipText, formatFilter === 'all' && styles.filterChipTextActive]}
          >
            Todos
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filtrar videos online"
          accessibilityState={{ selected: formatFilter === 'video' }}
          style={[styles.filterChip, formatFilter === 'video' && styles.filterChipActive]}
          onPress={() => setFormatFilter('video')}
        >
          <Text
            style={[styles.filterChipText, formatFilter === 'video' && styles.filterChipTextActive]}
          >
            Videos
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filtrar infografías descargables"
          accessibilityState={{ selected: formatFilter === 'infografia' }}
          style={[styles.filterChip, formatFilter === 'infografia' && styles.filterChipActive]}
          onPress={() => setFormatFilter('infografia')}
        >
          <Text
            style={[
              styles.filterChipText,
              formatFilter === 'infografia' && styles.filterChipTextActive,
            ]}
          >
            Infografías
          </Text>
        </Pressable>
      </View>

      {loadingData ? (
        <BodyText>Cargando materiales de la categoría…</BodyText>
      ) : dataError ? (
        <InfoCard>
          <Text style={styles.errorText}>No se pudo cargar la información de la categoría.</Text>
        </InfoCard>
      ) : value?.resources.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Sin contenidos en este formato"
          description="No se encontraron recursos educativos con el filtro seleccionado en esta categoría."
        />
      ) : (
        value?.resources.map((resource) => {
          const copy = copyMap.get(resource.id);
          const interaction = interactionMap.get(resource.id);

          const fileExists =
            patientId && copy?.rutaRelativa
              ? resourceFileExists(patientId, resource.id, copy.rutaRelativa)
              : false;
          const isDownloaded = Boolean(copy && fileExists && copy.estado !== 'error');

          const typeIcon =
            resource.type === 'video'
              ? 'video'
              : resource.type === 'infografia'
                ? 'image'
                : 'file-text';

          const formatChipLabel =
            resource.type === 'video'
              ? 'Video · Requiere internet'
              : resource.type === 'infografia'
                ? isDownloaded
                  ? 'Infografía · Disponible sin internet'
                  : 'Infografía · Disponible para guardar'
                : isDownloaded
                  ? 'Guía · Disponible sin internet'
                  : 'Guía · Disponible para guardar';

          const isReviewed =
            resource.type === 'video'
              ? Boolean(interaction?.revisionDeclaradaEn)
              : Boolean(copy?.revisionDeclarada);

          const reviewedDate =
            resource.type === 'video'
              ? interaction?.revisionDeclaradaEn
                ? formatDate(interaction.revisionDeclaradaEn)
                : null
              : copy?.revisionDeclaradaEn
                ? formatDate(copy.revisionDeclaradaEn)
                : null;

          return (
            <View key={resource.id} style={styles.cardContainer}>
              {/* Área principal táctil: 1 toque abre el recurso directamente */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${resource.title}, ${formatChipLabel}`}
                onPress={() => void handleDirectOpen(resource)}
                style={styles.cardMainPressable}
              >
                <Feather name={typeIcon} size={28} color={appTheme.colors.primary} />
                <View style={styles.cardContent}>
                  <Text style={styles.heading}>{resource.title}</Text>
                  <View style={styles.chipsRow}>
                    <StatusPill>{formatChipLabel}</StatusPill>
                    {isReviewed && reviewedDate ? (
                      <StatusPill>{`Revisado el ${reviewedDate}`}</StatusPill>
                    ) : null}
                  </View>
                </View>
              </Pressable>

              {/* Botón aislado para información y acciones individuales */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Información de ${resource.title}`}
                onPress={() => {
                  setModalError(null);
                  setInfoResource(resource);
                }}
                style={styles.cardInfoButton}
              >
                <Feather name="info" size={20} color={appTheme.colors.primary} />
                <Text style={styles.cardInfoButtonText}>Info</Text>
              </Pressable>
            </View>
          );
        })
      )}

      {/* Modal de Información con metadatos y acciones individuales */}
      {infoResource ? (
        <Modal
          visible={Boolean(infoResource)}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            setInfoResource(null);
            setModalError(null);
          }}
          accessibilityViewIsModal={true}
        >
          {(() => {
            const currentCopy = copyMap.get(infoResource.id);
            const currentInteraction = interactionMap.get(infoResource.id);
            const fileExists =
              patientId && currentCopy?.rutaRelativa
                ? resourceFileExists(patientId, infoResource.id, currentCopy.rutaRelativa)
                : false;
            const isDownloaded = Boolean(
              currentCopy && fileExists && currentCopy.estado !== 'error',
            );
            const isFileMissing = Boolean(
              currentCopy && (!fileExists || currentCopy.estado === 'error'),
            );

            return (
              <View style={styles.modalOverlay}>
                <View style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <View style={{ flex: 1 }}>
                      <SectionTitle>{infoResource.title}</SectionTitle>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cerrar información"
                      onPress={() => {
                        setInfoResource(null);
                        setModalError(null);
                      }}
                      style={styles.modalCloseIcon}
                    >
                      <Feather name="x" size={24} color={appTheme.colors.text} />
                    </Pressable>
                  </View>

                  <ScrollView style={styles.modalScroll} contentContainerStyle={{ gap: 12 }}>
                    <BodyText>{infoResource.description}</BodyText>
                    <BodyText>Categoría: {infoResource.categoryName}</BodyText>
                    {infoResource.estimatedReadTimeMinutes ? (
                      <BodyText>
                        Tiempo estimado: ~{infoResource.estimatedReadTimeMinutes} minutos
                      </BodyText>
                    ) : null}

                    <View style={styles.noticeBox}>
                      <StatusPill>
                        {infoResource.type === 'video'
                          ? currentInteraction?.revisionDeclaradaEn
                            ? `Video revisado el ${formatDate(currentInteraction.revisionDeclaradaEn)}`
                            : currentInteraction
                              ? 'Video abierto (pendiente de confirmar)'
                              : 'Disponible online'
                          : isDownloaded
                            ? currentCopy?.revisionDeclarada
                              ? `Material revisado el ${currentCopy.revisionDeclaradaEn ? formatDate(currentCopy.revisionDeclaradaEn) : 'sí'}`
                              : 'Guardado en este dispositivo'
                            : isFileMissing
                              ? 'Archivo no disponible'
                              : 'Disponible para guardar'}
                      </StatusPill>
                    </View>

                    {infoResource.type === 'video' ? (
                      <View style={styles.noticeBox}>
                        <Feather name="info" size={18} color={appTheme.colors.primary} />
                        <Text style={styles.noticeText}>
                          Los videos educativos se abren externamente en YouTube y requieren
                          conexión activa.
                        </Text>
                      </View>
                    ) : null}

                    {modalError ? (
                      <Text accessibilityRole="alert" style={styles.errorText}>
                        {modalError}
                      </Text>
                    ) : null}
                  </ScrollView>

                  <View style={styles.modalFooter}>
                    {infoResource.type === 'video' ? (
                      <>
                        <VisualButton
                          label={modalActionBusy ? 'Abriendo…' : 'Abrir en YouTube'}
                          disabled={modalActionBusy}
                          onPress={() => void handleDirectOpen(infoResource)}
                        />
                        {currentInteraction && !currentInteraction.revisionDeclaradaEn ? (
                          <VisualButton
                            label={modalActionBusy ? 'Confirmando…' : 'Marcar como visto'}
                            secondary
                            disabled={modalActionBusy}
                            onPress={() => void handleDeclareVideoReviewedFromModal(infoResource)}
                          />
                        ) : null}
                      </>
                    ) : isDownloaded ? (
                      <>
                        <VisualButton
                          label="Ver en pantalla completa"
                          disabled={modalActionBusy}
                          onPress={() => {
                            setInfoResource(null);
                            router.push(
                              '/visor-infografia?recurso=' + encodeURIComponent(infoResource.id),
                            );
                          }}
                        />
                        {!currentCopy?.revisionDeclarada ? (
                          <VisualButton
                            label={modalActionBusy ? 'Confirmando…' : 'Marcar como visto'}
                            disabled={modalActionBusy}
                            onPress={() => void handleDeclareCopyReviewedFromModal(infoResource)}
                          />
                        ) : null}
                        <VisualButton
                          label={modalActionBusy ? 'Quitando…' : 'Quitar descarga'}
                          secondary
                          disabled={modalActionBusy}
                          onPress={() => void handleDeleteFromModal(infoResource, currentCopy)}
                        />
                      </>
                    ) : isFileMissing ? (
                      <>
                        <VisualButton
                          label={modalActionBusy ? 'Descargando…' : 'Reintentar descarga'}
                          disabled={modalActionBusy}
                          onPress={() => void handleSaveFromModal(infoResource)}
                        />
                        <VisualButton
                          label={modalActionBusy ? 'Quitando…' : 'Quitar descarga'}
                          secondary
                          disabled={modalActionBusy}
                          onPress={() => void handleDeleteFromModal(infoResource, currentCopy)}
                        />
                      </>
                    ) : (
                      <>
                        <VisualButton
                          label="Ver en pantalla completa"
                          secondary
                          disabled={modalActionBusy}
                          onPress={() => {
                            setInfoResource(null);
                            router.push(
                              '/visor-infografia?recurso=' + encodeURIComponent(infoResource.id),
                            );
                          }}
                        />
                        <VisualButton
                          label={modalActionBusy ? 'Guardando…' : 'Guardar infografía sin conexión'}
                          disabled={modalActionBusy || !repository}
                          onPress={() => void handleSaveFromModal(infoResource)}
                        />
                      </>
                    )}
                    <VisualButton
                      label="Cerrar"
                      secondary
                      onPress={() => {
                        setInfoResource(null);
                        setModalError(null);
                      }}
                    />
                  </View>
                </View>
              </View>
            );
          })()}
        </Modal>
      ) : null}
    </Screen>
  );
}

export function EducationResourceScreen() {
  const { theme: appTheme } = useAppTheme();
  const { patientId, repository, runSave, saving, database, manager } = useLocalData();
  const styles = useStyles();
  const { recurso } = useLocalSearchParams<{ recurso?: string }>();

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadResourceData = useCallback(async () => {
    if (!recurso) return null;
    return getEducationalCatalogReader().getResourceById(recurso);
  }, [recurso]);

  const { value: resource, loading: loadingResource } = useFocusedValue(loadResourceData, null);

  const loadStatus = useCallback(async () => {
    if (!repository || !patientId || !recurso) {
      return {
        copy: null as EducationalLocalCopy | null,
        interaction: null as EducationalInteraction | null,
      };
    }
    await reconcileResourceCopies(patientId, repository).catch(() => undefined);
    const [copy, interaction] = await Promise.all([
      repository.education.getLocalCopy(recurso),
      repository.education.getInteraction(recurso),
    ]);
    return { copy, interaction };
  }, [repository, patientId, recurso]);

  const { value: statusData, refresh: refreshStatus } = useFocusedValue(loadStatus, {
    copy: null as EducationalLocalCopy | null,
    interaction: null as EducationalInteraction | null,
  });

  const [readingContent, setReadingContent] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);

  const localCopy = statusData?.copy;
  const interaction = statusData?.interaction;

  const effectiveResource: EducationalResource | null =
    resource ??
    (localCopy
      ? {
          id: recurso ?? localCopy.contentId,
          title: localCopy.titulo ?? localCopy.metadataLocal?.titulo ?? 'Material guardado',
          category: 0,
          categoryName: 'Material local',
          description:
            localCopy.descripcion ??
            localCopy.metadataLocal?.descripcion ??
            'Copia local disponible para lectura sin conexión.',
          type:
            localCopy.tipo ??
            localCopy.metadataLocal?.tipo ??
            (localCopy.formato === 'markdown' ? 'guia' : 'infografia'),
          version:
            localCopy.metadataLocal?.versionOrigen ??
            localCopy.metadataLocal?.sha256?.slice(0, 8) ??
            'local',
        }
      : null);

  if (loadingResource) {
    return (
      <Screen title="Cargando recurso">
        <DemoBadge />
        <BodyText>Obteniendo información del recurso educativo…</BodyText>
      </Screen>
    );
  }

  if (!effectiveResource) {
    return (
      <Screen title="Recurso no encontrado">
        <DemoBadge />
        <EmptyState
          icon="alert-circle"
          title="Recurso no disponible"
          description="No se encontró el material educativo solicitado en el catálogo."
        />
      </Screen>
    );
  }

  const fileExists =
    patientId && localCopy?.rutaRelativa
      ? resourceFileExists(patientId, effectiveResource.id, localCopy.rutaRelativa)
      : false;
  const isDownloaded = Boolean(localCopy && fileExists && localCopy.estado !== 'error');
  const isFileMissing = Boolean(localCopy && (!fileExists || localCopy.estado === 'error'));
  const busy = actionBusy || saving;

  async function handleOpenYouTube() {
    if (!repository || !patientId || !effectiveResource?.youtubeVideoId || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      const netState = await Network.getNetworkStateAsync();
      if (!netState.isConnected || netState.isInternetReachable === false) {
        setOpError(
          'No hay conexión a internet disponible. Los videos de YouTube requieren conexión activa para su reproducción.',
        );
        return;
      }

      const res = await executeYouTubeLaunch({
        resourceId: effectiveResource.id,
        youtubeVideoId: effectiveResource.youtubeVideoId,
        version: effectiveResource.version,
        patientId,
        repository,
        runSave,
        expectedPatientId: patientId,
        getCurrentPatientId: () => manager.getPatientId(),
        expectedEpoch: manager.getContextEpoch(),
        getCurrentEpoch: () => manager.getContextEpoch(),
      });

      if (!res.success && res.error) {
        setOpError(res.error);
      }
      refreshStatus();
    } catch {
      setOpError('Error al iniciar la apertura externa de YouTube.');
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  async function handleDeclareYouTubeReviewed() {
    if (!repository || !patientId || !effectiveResource?.youtubeVideoId || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      await runSave(async () => {
        const res = await repository.education.declareYouTubeReviewed({
          contentId: effectiveResource.id,
          youtubeVideoId: effectiveResource.youtubeVideoId!,
          versionOrigen: effectiveResource.version,
        });
        if (!res.updated) {
          throw new Error('No se pudo confirmar la revisión del video.');
        }
      });
      refreshStatus();
    } catch {
      setOpError('No se pudo registrar la declaración de revisión del video.');
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  async function handleSaveOfflineCopy() {
    if (!repository || !patientId || !effectiveResource || busy || !database) return;
    if (!resource) {
      setOpError(
        'El catálogo es necesario para recuperar o descargar una nueva copia. Solo la lectura de la copia existente está disponible.',
      );
      return;
    }
    setActionBusy(true);
    setOpError(null);

    try {
      await runSave(async () => {
        await downloadAndSaveInfographic({
          resource,
          patientId,
          repository,
          database,
          localCopy,
        });
      });
      refreshStatus();
    } catch (err) {
      setOpError(
        err instanceof Error
          ? err.message
          : 'No se pudo guardar la copia sin conexión en el dispositivo.',
      );
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  async function handleDeclareCopyReviewed() {
    if (!repository || !patientId || !effectiveResource || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      await runSave(async () => {
        await repository.education.declareCopyReviewed(effectiveResource.id);
      });
      refreshStatus();
    } catch {
      setOpError('No se pudo registrar la revisión de la copia local.');
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  async function handleDeleteCopy() {
    if (!repository || !patientId || !effectiveResource || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      await runSave(async () => {
        await removeLocalInfographicCopy({
          contentId: effectiveResource.id,
          patientId,
          repository,
          localCopy,
        });
      });
      setReadingContent(null);
      setImageLoaded(false);
      setImageLoadError(false);
      refreshStatus();
    } catch (err) {
      setOpError(
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar el archivo local en el dispositivo.',
      );
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  async function handleReadGuide() {
    if (!patientId || !effectiveResource || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      const text = await readResourceFile(patientId, effectiveResource.id, localCopy?.rutaRelativa);
      if (text) {
        setReadingContent(text);
      } else {
        setOpError('No se pudo leer el archivo de la guía en el disco.');
      }
    } catch {
      setOpError('Error al leer el archivo desde el almacenamiento local.');
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  return (
    <Screen title={effectiveResource.title}>
      <DemoBadge />

      <InfoCard>
        <SectionTitle>{effectiveResource.title}</SectionTitle>
        <BodyText>{effectiveResource.description}</BodyText>
        <BodyText>Categoría: {effectiveResource.categoryName}</BodyText>
        {effectiveResource.estimatedReadTimeMinutes ? (
          <BodyText>
            Tiempo estimado: ~{effectiveResource.estimatedReadTimeMinutes} minutos
          </BodyText>
        ) : null}
      </InfoCard>

      <InfoCard>
        <SectionTitle>Estado en este dispositivo</SectionTitle>
        <StatusPill>
          {effectiveResource.type === 'video'
            ? interaction?.revisionDeclaradaEn
              ? `Video revisado el ${formatDate(interaction.revisionDeclaradaEn)}`
              : interaction
                ? 'Video abierto (pendiente de confirmar)'
                : 'Disponible online'
            : isDownloaded
              ? localCopy?.revisionDeclarada
                ? `Material revisado el ${localCopy.revisionDeclaradaEn ? formatDate(localCopy.revisionDeclaradaEn) : 'sí'}`
                : 'Copia guardada en disco (pendiente de revisión)'
              : isFileMissing
                ? 'Archivo no disponible'
                : 'Disponible para descarga'}
        </StatusPill>

        {effectiveResource.type === 'video' ? (
          <View style={styles.noticeBox}>
            <Feather name="info" size={18} color={appTheme.colors.primary} />
            <Text style={styles.noticeText}>
              Los videos educativos se abren externamente en YouTube y requieren conexión activa. No
              se descargan videos al almacenamiento local.
            </Text>
          </View>
        ) : null}
      </InfoCard>

      {/* Texto explicativo accesible para lectura offline / TalkBack */}
      {effectiveResource.textoAccesible ? (
        <InfoCard>
          <SectionTitle>Contenido explicativo accesible</SectionTitle>
          <BodyText style={{ lineHeight: 22 }}>{effectiveResource.textoAccesible}</BodyText>
        </InfoCard>
      ) : null}

      {/* Visor de infografía (PNG) */}
      {effectiveResource.type === 'infografia' && isDownloaded && localCopy?.rutaRelativa ? (
        <InfoCard>
          <SectionTitle>Infografía guardada en disco</SectionTitle>
          <Image
            key={`infographic-${localCopy.rutaRelativa}-${imageRetryCount}`}
            source={{ uri: localCopy.rutaRelativa }}
            style={styles.infographicImage}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel={`Infografía: ${effectiveResource.title}`}
            onLoad={() => {
              setImageLoaded(true);
              setImageLoadError(false);
            }}
            onError={() => {
              setImageLoaded(false);
              setImageLoadError(true);
            }}
          />
          {imageLoadError ? (
            <View style={{ gap: 8 }}>
              <View style={styles.imageLoadingBox}>
                <Feather name="alert-triangle" size={18} color={appTheme.colors.error} />
                <BodyText style={{ color: appTheme.colors.error }}>
                  No se pudo renderizar la infografía desde el almacenamiento local. El archivo
                  podría estar dañado o no ser compatible.
                </BodyText>
              </View>
              <VisualButton
                label="Reintentar visualización"
                secondary
                onPress={() => {
                  setImageLoadError(false);
                  setImageLoaded(false);
                  setImageRetryCount((c) => c + 1);
                }}
              />
            </View>
          ) : !imageLoaded ? (
            <View style={styles.imageLoadingBox}>
              <ActivityIndicator color={appTheme.colors.primary} />
              <BodyText>Cargando visualización de imagen…</BodyText>
            </View>
          ) : null}
          <BodyText>
            {Math.max(1, Math.round(localCopy.tamanoBytes / 1024))} KB · Guardado en el dispositivo
          </BodyText>
        </InfoCard>
      ) : null}

      {/* Visor de lectura Markdown para guías */}
      {readingContent ? (
        <InfoCard>
          <SectionTitle>Contenido local del archivo</SectionTitle>
          <BodyText>{readingContent}</BodyText>
        </InfoCard>
      ) : null}

      {opError ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {opError}
        </Text>
      ) : null}

      {/* Botones de acción según el tipo de recurso */}
      {effectiveResource.type === 'video' ? (
        <View style={styles.stack}>
          <VisualButton
            label={busy ? 'Abriendo…' : 'Abrir en YouTube'}
            disabled={busy}
            onPress={() => void handleOpenYouTube()}
          />
          {interaction && !interaction.revisionDeclaradaEn ? (
            <VisualButton
              label={busy ? 'Confirmando…' : 'Declarar video revisado'}
              secondary
              disabled={busy}
              onPress={() => void handleDeclareYouTubeReviewed()}
            />
          ) : null}
        </View>
      ) : isDownloaded ? (
        <View style={styles.stack}>
          {effectiveResource.type === 'guia' ? (
            <VisualButton
              label={readingContent ? 'Cerrar lectura' : 'Leer recurso sin conexión'}
              disabled={busy}
              onPress={
                readingContent ? () => setReadingContent(null) : () => void handleReadGuide()
              }
            />
          ) : null}

          {effectiveResource.type === 'infografia' ? (
            <VisualButton
              label="Ver en pantalla completa"
              onPress={() =>
                router.push('/visor-infografia?recurso=' + encodeURIComponent(effectiveResource.id))
              }
            />
          ) : null}

          {!localCopy?.revisionDeclarada ? (
            <VisualButton
              label={busy ? 'Confirmando…' : 'Declarar material revisado'}
              disabled={
                busy ||
                (effectiveResource.type === 'infografia' && (!imageLoaded || imageLoadError))
              }
              onPress={() => void handleDeclareCopyReviewed()}
            />
          ) : null}

          <VisualButton
            label={busy ? 'Quitando…' : 'Quitar descarga'}
            secondary
            disabled={busy}
            onPress={() => void handleDeleteCopy()}
          />
        </View>
      ) : isFileMissing ? (
        <View style={styles.stack}>
          <InfoCard>
            <SectionTitle>Archivo no disponible</SectionTitle>
            <BodyText>
              La copia física no se encuentra en el almacenamiento local o presentó errores al
              guardar. Puedes reintentar la descarga para restaurarla.
            </BodyText>
          </InfoCard>
          <VisualButton
            label={busy ? 'Descargando…' : 'Reintentar descarga'}
            disabled={busy || !repository}
            onPress={() => void handleSaveOfflineCopy()}
          />
          <VisualButton
            label={busy ? 'Quitando…' : 'Quitar descarga'}
            secondary
            disabled={busy || !repository}
            onPress={() => void handleDeleteCopy()}
          />
        </View>
      ) : (
        <VisualButton
          label={
            busy
              ? 'Guardando copia…'
              : effectiveResource.type === 'infografia'
                ? 'Guardar infografía sin conexión'
                : 'Guardar copia sin conexión'
          }
          disabled={busy || !repository}
          onPress={() => void handleSaveOfflineCopy()}
        />
      )}
    </Screen>
  );
}

export function EducationStateScreen() {
  const { estado } = useLocalSearchParams<{ estado?: string }>();
  const state =
    estado === 'cargando' || estado === 'error' || estado === 'sin-conexion' ? estado : 'vacia';
  const copy = {
    vacia: ['Sin recursos', 'Todavía no hay materiales en esta categoría.'],
    cargando: ['Cargando recursos', 'Estado de carga de ejemplo.'],
    error: ['No se pudo mostrar el contenido', 'Estado de error de ejemplo.'],
    'sin-conexion': ['Requiere conexión', 'Este recurso no está descargado.'],
  }[state];
  return (
    <Screen title="Estado de biblioteca">
      <DemoBadge />
      <EmptyState
        icon={state === 'sin-conexion' ? 'wifi-off' : 'book-open'}
        title={copy[0]}
        description={copy[1]}
      />
    </Screen>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  return StyleSheet.create({
    row: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: appTheme.colors.surface,
    },
    copiesCard: {
      borderWidth: 1,
      borderColor: appTheme.colors.primary,
      backgroundColor: appTheme.colors.mutedSurface,
    },
    diagnosticCard: {
      borderWidth: 1,
      borderColor: appTheme.colors.border,
      marginTop: theme.spacing.sm,
    },
    copy: { flex: 1, gap: theme.spacing.xs },
    heading: { fontSize: 17, fontWeight: '700', color: appTheme.colors.text },
    stack: { gap: theme.spacing.md },
    placeholder: {
      height: 180,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.sm,
      backgroundColor: appTheme.colors.mutedSurface,
    },
    noticeBox: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      padding: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      backgroundColor: appTheme.colors.mutedSurface,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
      marginTop: theme.spacing.xs,
    },
    noticeText: {
      flex: 1,
      fontSize: 13,
      color: appTheme.colors.text,
      lineHeight: 18,
    },
    infographicImage: {
      width: '100%',
      height: 380,
      borderRadius: theme.radius.sm,
      backgroundColor: appTheme.colors.mutedSurface,
    },
    imageLoadingBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      padding: theme.spacing.sm,
    },
    errorText: { color: appTheme.colors.error, fontSize: 14, fontWeight: '600' },
    filterRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.sm,
    },
    filterChip: {
      minHeight: 48,
      minWidth: 48,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 9999,
      backgroundColor: appTheme.colors.mutedSurface,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    filterChipActive: {
      backgroundColor: appTheme.colors.primary,
      borderColor: appTheme.colors.primary,
    },
    filterChipText: {
      fontSize: 14,
      fontWeight: '600',
      color: appTheme.colors.text,
    },
    filterChipTextActive: {
      color: appTheme.colors.onPrimary,
    },
    cardContainer: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: theme.radius.md,
      backgroundColor: appTheme.colors.surface,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
      padding: theme.spacing.sm,
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    cardMainPressable: {
      flex: 1,
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.xs,
    },
    cardContent: {
      flex: 1,
      gap: 4,
    },
    chipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 2,
    },
    cardInfoButton: {
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: theme.radius.sm,
      backgroundColor: appTheme.colors.mutedSurface,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 2,
    },
    cardInfoButtonText: {
      fontSize: 11,
      fontWeight: '600',
      color: appTheme.colors.primary,
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
      maxHeight: '85%',
      backgroundColor: appTheme.colors.surface,
      borderRadius: theme.radius.md,
      padding: 20,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
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
    modalFooter: {
      marginTop: 8,
      gap: 8,
    },
    offlineFilterHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    activeFilterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 9999,
      backgroundColor: appTheme.colors.primary,
    },
    activeFilterChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: appTheme.colors.onPrimary,
    },
    exitFilterButton: {
      minHeight: 48,
      minWidth: 48,
      paddingHorizontal: 12,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
      backgroundColor: appTheme.colors.surface,
    },
    exitFilterButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: appTheme.colors.text,
    },
    downloadBanner: {
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: appTheme.colors.surface,
      borderWidth: 1,
      borderColor: appTheme.colors.primary,
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.sm,
    },
    downloadBannerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    downloadBannerTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: appTheme.colors.text,
    },
    downloadBannerSubtitle: {
      fontSize: 13,
      color: appTheme.colors.secondary,
    },
    summaryBanner: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: appTheme.colors.mutedSurface,
      borderWidth: 1,
      borderColor: appTheme.colors.primary,
      marginVertical: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    summaryBannerContentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      width: '100%',
    },
    summaryBannerText: {
      flex: 1,
      fontSize: 14,
      fontWeight: '600',
      color: appTheme.colors.text,
    },
    summaryCloseIcon: {
      minWidth: 48,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
    },
    summaryRetryContainer: {
      width: '100%',
      marginTop: 4,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: appTheme.colors.errorContainer,
      borderWidth: 1,
      borderColor: appTheme.colors.error,
      marginVertical: theme.spacing.xs,
    },
    errorBannerText: {
      flex: 1,
      fontSize: 14,
      fontWeight: '600',
      color: appTheme.colors.onErrorContainer,
    },
    bulkDownloadCard: {
      marginVertical: theme.spacing.xs,
    },
  });
}
