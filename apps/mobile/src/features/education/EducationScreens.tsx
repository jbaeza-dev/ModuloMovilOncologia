import { AppIcon as Feather } from '../../components/AppIcon';
import * as Network from 'expo-network';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { searchEducationalContent, type EducationSearchFilter } from './education-search';
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
import { ActionCard } from '../../components/ActionCard';
import { usePodcastCatalog } from './use-podcast-catalog';
import { EDUCATIONAL_CATEGORIES } from './educational-categories';
import { MascotHero } from '../../components/MascotAvatar';
import {
  BodyText,
  DemoBadge,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
  VisualField,
  ChoiceChip,
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
import {
  EducationContentRevisionContext,
  EducationStatusRevisionContext,
} from '../../providers/QueryRevision';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import {
  type EducationalCategory,
  type EducationalFormatFilter,
} from './educational-catalog-service';
import { useEducationalCatalog, CatalogStatusNotice } from './use-educational-catalog';
import {
  downloadAndSaveInfographic,
  verifiedLocalImageCopy,
  removeLocalInfographicCopy,
} from './infographic-storage-service';
import { executeYouTubeLaunch } from './youtube-launcher';

export { downloadAndSaveInfographic, removeLocalInfographicCopy };

export function EducationScreen() {
  const { episodes: publishedPodcasts } = usePodcastCatalog();
  const catalogReader = useEducationalCatalog();
  const [query, setQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<EducationSearchFilter>('all');
  useEffect(() => {
    setQuery('');
    setSearchFilter('all');
  }, [catalogReader]);
  const loadResources = useCallback(
    async () => ({ source: catalogReader, resources: await catalogReader.getAllResources() }),
    [catalogReader],
  );
  const { patientId: screenPatientId } = useLocalData();
  const searchCatalog = useFocusedValue(loadResources, null, {
    queryKey: `${screenPatientId ?? 'default'}:education:search-catalog`,
    context: EducationContentRevisionContext,
  });
  const currentResources =
    searchCatalog.value?.source === catalogReader ? searchCatalog.value.resources : [];
  const searching = query.trim().length > 0 || searchFilter !== 'all';
  const searchResults = searching
    ? searchEducationalContent(currentResources, query, searchFilter, publishedPodcasts)
    : [];
  const load = useCallback(async () => {
    const categories = await catalogReader.getCategories();
    return categories.map((category) => {
      const known = EDUCATIONAL_CATEGORIES.find(
        (entry) =>
          entry.title.localeCompare(category.title.trim(), 'es', { sensitivity: 'base' }) === 0,
      );
      return {
        ...category,
        icon: known?.icon ?? category.icon,
        description: category.description ?? known?.description,
      };
    });
  }, [catalogReader]);
  const { patientId } = useLocalData();
  const {
    items: categories,
    error,
    loading,
    refresh,
  } = useFocusedList(load, {
    queryKey: `${patientId ?? 'default'}:education:categories`,
    context: EducationContentRevisionContext,
  });
  return (
    <Screen isRoot showHelp showProfile>
      <MascotHero
        pose="lectura"
        eyebrow="MATERIAL CUIDAQUIMIO"
        title="Aprende a tu ritmo."
        description="Guías, videos y podcasts para acompañarte."
        compact
      />
      <DemoBadge />
      <VisualField
        label="Buscar contenido"
        placeholder="Infografía, video o podcast"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        maxLength={120}
        returnKeyType="search"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
        style={{ flexGrow: 0 }}
      >
        {(
          [
            ['all', 'Todo'],
            ['infografia', 'Infografías'],
            ['video', 'Videos'],
            ['podcast', 'Podcasts'],
          ] as const
        ).map(([id, label]) => (
          <ChoiceChip
            key={id}
            label={label}
            selected={searchFilter === id}
            onPress={() => setSearchFilter(id)}
          />
        ))}
      </ScrollView>
      {searching ? (
        <>
          {searchCatalog.loading ? <BodyText>Buscando contenido…</BodyText> : null}
          {searchCatalog.error ? (
            <InfoCard>
              <BodyText>No se pudo consultar todo el contenido.</BodyText>
              <VisualButton label="Reintentar búsqueda" onPress={searchCatalog.refresh} />
            </InfoCard>
          ) : null}
          {!searchCatalog.loading && !searchCatalog.error && !searchResults.length ? (
            <EmptyState
              icon="search"
              title="No encontramos coincidencias"
              description="Prueba con otra palabra."
            />
          ) : null}
          {searchResults.map((result) => {
            const handlePress = () => {
              if (result.type === 'podcast') {
                router.push('/educacion/podcasts?episodio=' + encodeURIComponent(result.id));
              } else if (result.type === 'video') {
                const resource = currentResources.find((r) => r.id === result.id);
                const videoId = resource?.youtubeVideoId;
                if (videoId) {
                  router.push({
                    pathname: '/educacion/video-youtube',
                    params: {
                      videoId,
                      resourceId: resource.id,
                      version: resource.version,
                      title: resource.title,
                      description: resource.description,
                    },
                  });
                } else {
                  router.push('/educacion/recurso?recurso=' + encodeURIComponent(result.id));
                }
              } else if (result.type === 'infografia') {
                router.push('/visor-infografia?recurso=' + encodeURIComponent(result.id));
              } else {
                router.push('/educacion/recurso?recurso=' + encodeURIComponent(result.id));
              }
            };

            return (
              <ActionCard
                key={result.key}
                title={result.title}
                description={result.subtitle}
                icon={result.type === 'podcast' || result.type === 'video' ? 'play' : 'book-open'}
                onPress={handlePress}
              />
            );
          })}
          <VisualButton
            label="Limpiar búsqueda"
            secondary
            onPress={() => {
              setQuery('');
              setSearchFilter('all');
            }}
          />
        </>
      ) : (
        <>
          <ActionCard
            title={`Podcasts (${publishedPodcasts.length})`}
            icon="play"
            description="Escucha con internet"
            onPress={() => router.push('/educacion/podcasts')}
          />
          <SectionTitle>Categorías CUIDAQUIMIO</SectionTitle>
          {error ? (
            <InfoCard>
              <BodyText>
                No pudimos abrir las categorías. Tus guías guardadas se conservan.
              </BodyText>
              <VisualButton label="Reintentar categorías" secondary onPress={refresh} />
            </InfoCard>
          ) : null}
          {loading ? <BodyText>Buscando categorías…</BodyText> : null}
          {categories
            .slice()
            .sort(
              (a, b) =>
                Number(b.title.trim().toLowerCase() === 'signos de alarma') -
                Number(a.title.trim().toLowerCase() === 'signos de alarma'),
            )
            .map((category) => (
              <ActionCard
                key={category.id}
                title={category.title}
                icon={
                  category.title.trim().toLowerCase() === 'signos de alarma'
                    ? 'alert-triangle'
                    : category.icon
                }
                tone={
                  category.title.trim().toLowerCase() === 'signos de alarma' ? 'warning' : 'neutral'
                }
                description={category.description || category.countLabel}
                onPress={() => router.push('/educacion/categoria?categoria=' + String(category.id))}
              />
            ))}
        </>
      )}
      <CatalogStatusNotice />
    </Screen>
  );
}

export function EducationCategoryScreen() {
  const catalogReader = useEducationalCatalog();
  const { theme: appTheme } = useAppTheme();
  const { repository, patientId, runSave, database, manager } = useLocalData();
  const styles = useStyles();

  const [formatFilter, setFormatFilter] = useState<EducationalFormatFilter>('all');
  const [infoResource, setInfoResource] = useState<EducationalResource | null>(null);
  const [modalActionBusy, setModalActionBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const { categoria } = useLocalSearchParams<{ categoria?: string }>();

  const loadData = useCallback(async () => {
    const reader = catalogReader;
    const categories = await reader.getCategories();
    const selectedCategory = categories.find(
      (c) => c.slug === categoria || String(c.id) === categoria,
    );
    const [resources, copies, interactions] = await Promise.all([
      selectedCategory
        ? reader.getResourcesByCategory(selectedCategory.id, formatFilter)
        : Promise.resolve([]),
      repository && patientId ? repository.education.listLocalCopies() : Promise.resolve([]),
      repository && patientId ? repository.education.listInteractions() : Promise.resolve([]),
    ]);

    if (repository && patientId) {
      void reconcileResourceCopies(patientId, repository).catch(() => undefined);
    }

    return { currentCategory: selectedCategory, resources, copies, interactions };
  }, [categoria, formatFilter, repository, patientId, catalogReader]);

  const statusRevision = useContext(EducationStatusRevisionContext);
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
  }>(
    loadData,
    {
      currentCategory: undefined,
      resources: [],
      copies: [],
      interactions: [],
    },
    {
      queryKey: `${patientId ?? 'default'}:education:category:${categoria}:${formatFilter}`,
      context: EducationContentRevisionContext,
      extraRevision: statusRevision,
    },
  );

  const copyMap = new Map((value?.copies ?? []).map((c) => [c.contentId, c]));
  const interactionMap = new Map((value?.interactions ?? []).map((i) => [i.contentId, i]));

  // Acceso directo con 1 toque según tipo de recurso
  async function handleDirectOpen(resource: EducationalResource) {
    if (resource.type === 'video') {
      const res = await executeYouTubeLaunch({
        openVideo: async (videoId) => {
          router.push({
            pathname: '/educacion/video-youtube',
            params: {
              videoId,
              resourceId: resource.id,
              version: resource.version,
              title: resource.title,
              description: resource.description,
            },
          });
          return { success: true };
        },
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
        Alert.alert('Video educativo', res.error);
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
          : 'No se pudo eliminar el archivo guardado en este teléfono.',
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
      setModalError('No se pudo guardar que revisaste este material.');
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
    <Screen mascotPose="lectura" title={value?.currentCategory?.title ?? 'Categoría educativa'}>
      <CatalogStatusNotice />
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
          accessibilityLabel="Filtrar videos"
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
                              : 'Requiere internet'
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
  const catalogReader = useEducationalCatalog();
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
    return catalogReader.getResourceById(recurso);
  }, [recurso, catalogReader]);

  const { value: resource, loading: loadingResource } = useFocusedValue(loadResourceData, null, {
    queryKey: `${patientId ?? 'default'}:education:resource:${recurso ?? 'none'}`,
    context: EducationContentRevisionContext,
  });

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
    return { copy: copy ? await verifiedLocalImageCopy(copy, patientId) : null, interaction };
  }, [repository, patientId, recurso]);

  const { value: statusData, refresh: refreshStatus } = useFocusedValue(
    loadStatus,
    {
      copy: null as EducationalLocalCopy | null,
      interaction: null as EducationalInteraction | null,
    },
    {
      queryKey: `${patientId ?? 'default'}:education:status:${recurso ?? 'none'}`,
      context: EducationStatusRevisionContext,
    },
  );

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
          categoryName: 'Material guardado',
          description:
            localCopy.descripcion ??
            localCopy.metadataLocal?.descripcion ??
            'Material disponible para leer sin conexión.',
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
      <Screen mascotPose="apoyo" title="Recurso no encontrado">
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
  const isOlderCopy =
    isDownloaded && resource && localCopy?.metadataLocal?.versionOrigen !== resource.version;
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
        openVideo: async (videoId) => {
          router.push({
            pathname: '/educacion/video-youtube',
            params: {
              videoId,
              resourceId: effectiveResource.id,
              version: effectiveResource.version,
              title: effectiveResource.title,
              description: effectiveResource.description,
            },
          });
          return { success: true };
        },
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
      setOpError('No se pudo abrir el video. Vuelve a intentarlo.');
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
      setOpError('No se pudo guardar que revisaste este material.');
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
          : 'No se pudo eliminar el archivo guardado en este teléfono.',
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
        if (repository) {
          void repository.education
            .markCopyViewed(effectiveResource.id)
            .then(() => refreshStatus())
            .catch(() => {});
        }
      } else {
        setOpError('No se pudo leer el archivo de la guía en el disco.');
      }
    } catch {
      setOpError('No se pudo abrir el archivo guardado en este teléfono.');
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  return (
    <Screen title={effectiveResource.title}>
      {isOlderCopy ? (
        <BodyText>
          La copia guardada corresponde a una revisión anterior. Actualízala con conexión para
          obtener la publicación vigente.
        </BodyText>
      ) : null}
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
                : 'Requiere internet'
            : isDownloaded
              ? localCopy?.revisionDeclarada
                ? `Material revisado el ${localCopy.revisionDeclaradaEn ? formatDate(localCopy.revisionDeclaradaEn) : 'sí'}`
                : 'Guardado en este teléfono (pendiente de revisión)'
              : isFileMissing
                ? 'Archivo no disponible'
                : 'Disponible para descarga'}
        </StatusPill>

        {effectiveResource.type === 'video' ? (
          <View style={styles.noticeBox}>
            <Feather name="info" size={18} color={appTheme.colors.primary} />
            <Text style={styles.noticeText}>
              Puedes ver este video aquí, dentro de QuimioCare. Necesitas conexión a internet; los
              videos no se descargan para verlos sin conexión.
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
          <SectionTitle>Infografía guardada en este teléfono</SectionTitle>
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
                  No se pudo mostrar la infografía guardada. El archivo podría estar dañado o no ser
                  compatible.
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
          <SectionTitle>Contenido guardado</SectionTitle>
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
              No encontramos el archivo guardado o hubo un problema al guardar. Puedes reintentar la
              descarga para restaurarla.
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
    <Screen mascotPose="resumen" title="Estado de biblioteca">
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
