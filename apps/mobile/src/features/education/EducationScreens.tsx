import Feather from '@expo/vector-icons/Feather';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import * as Network from 'expo-network';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

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
import type { SqlConnection } from '../../data/local/core/sql';
import type {
  EducationalInteraction,
  EducationalLocalCopy,
  EducationalResource,
} from '../../data/local/education/education-types';
import { launchYouTubeVideo } from '../../data/local/education/youtube';
import { saveEducationalMediaWithCompensation } from '../../data/local/files/educational-storage';
import {
  deleteResourceFile,
  readResourceFile,
  reconcileResourceCopies,
  resourceFileExists,
} from '../../data/local/files/resource-storage';
import { formatDate } from '../../data/local/repository';
import { useFocusedList, useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { DiagnosticsDemoModal } from './DiagnosticsDemoModal';
import {
  getEducationalCatalogReader,
  type EducationalCategory,
} from './educational-catalog-service';

const BUNDLED_ASSETS: Record<string, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  infografia_alimentacion_quimio: require('../../../assets/education/infografia_alimentacion_quimio.png'),
};

export function EducationScreen() {
  const { theme: appTheme } = useAppTheme();
  const { repository, patientId } = useLocalData();
  const styles = useStyles();

  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);

  const loadCopies = useCallback(async (): Promise<EducationalLocalCopy[]> => {
    if (!repository || !patientId) return [];
    return repository.education.listLocalCopies();
  }, [repository, patientId]);

  const { items: copies } = useFocusedList(loadCopies);

  const loadCategories = useCallback(async (): Promise<EducationalCategory[]> => {
    return getEducationalCatalogReader().getCategories();
  }, []);

  const { items: categories } = useFocusedList(loadCategories);

  return (
    <Screen title="Contenido educativo">
      <DemoBadge />
      <BodyText>
        Biblioteca multimedia sobre quimioterapia: guías e infografías descargables y videos
        educativos online.
      </BodyText>

      {/* Acceso a copias locales descargadas */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ver mis copias guardadas sin conexión"
        onPress={() => router.navigate('/educacion/copias')}
        style={[styles.row, styles.copiesCard]}
      >
        <Feather name="folder" size={28} color={appTheme.colors.primary} />
        <View style={styles.copy}>
          <Text style={styles.heading}>Mis copias guardadas</Text>
          <BodyText>
            {copies.length === 1
              ? '1 material disponible sin conexión'
              : `${copies.length} materiales disponibles sin conexión`}
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

      {/* Botón de diagnóstico demo release */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir diagnóstico demo de almacenamiento y red"
        onPress={() => setDiagnosticsVisible(true)}
        style={[styles.row, styles.diagnosticCard]}
      >
        <Feather name="activity" size={26} color={appTheme.colors.primary} />
        <View style={styles.copy}>
          <Text style={styles.heading}>Diagnóstico demo release</Text>
          <BodyText>Inspección de SQLite v7, red y simulación de fallos</BodyText>
        </View>
        <Feather name="chevron-right" size={22} color={appTheme.colors.text} />
      </Pressable>

      <DiagnosticsDemoModal
        visible={diagnosticsVisible}
        onClose={() => setDiagnosticsVisible(false)}
      />
    </Screen>
  );
}

export function EducationCategoryScreen() {
  const { theme: appTheme } = useAppTheme();
  const { repository, patientId } = useLocalData();
  const styles = useStyles();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { categoria } = useLocalSearchParams<{ categoria?: string }>();
  const categoryIndex = categoria === '1' || categoria === '2' ? Number(categoria) : 0;

  const loadData = useCallback(async () => {
    const reader = getEducationalCatalogReader();
    const [categories, resources, copies, interactions] = await Promise.all([
      reader.getCategories(),
      reader.getResourcesByCategory(categoryIndex),
      repository && patientId ? repository.education.listLocalCopies() : Promise.resolve([]),
      repository && patientId ? repository.education.listInteractions() : Promise.resolve([]),
    ]);

    if (repository && patientId) {
      await reconcileResourceCopies(patientId, repository).catch(() => undefined);
    }

    const currentCategory = categories.find((c) => c.id === categoryIndex) ?? categories[0];
    return { currentCategory, resources, copies, interactions };
  }, [categoryIndex, repository, patientId]);

  const {
    value,
    loading: loadingData,
    error: dataError,
  } = useFocusedValue(loadData, {
    currentCategory: undefined as EducationalCategory | undefined,
    resources: [] as EducationalResource[],
    copies: [] as EducationalLocalCopy[],
    interactions: [] as EducationalInteraction[],
  });

  const copyMap = new Map((value?.copies ?? []).map((c) => [c.contentId, c]));
  const interactionMap = new Map((value?.interactions ?? []).map((i) => [i.contentId, i]));

  return (
    <Screen title={value?.currentCategory?.title ?? 'Categoría'} backTo="/educacion">
      <DemoBadge />
      <BodyText>
        Material de muestra neutro para demostración técnica del acompañamiento educativo
        multimedia.
      </BodyText>

      {loadingData ? (
        <BodyText>Cargando materiales de la categoría…</BodyText>
      ) : dataError ? (
        <InfoCard>
          <Text style={styles.errorText}>No se pudo cargar la información de la categoría.</Text>
        </InfoCard>
      ) : (
        value?.resources.map((resource) => {
          const copy = copyMap.get(resource.id);
          const interaction = interactionMap.get(resource.id);

          const fileExists =
            patientId && copy?.rutaRelativa
              ? resourceFileExists(patientId, resource.id, copy.rutaRelativa)
              : false;
          const isDownloaded = Boolean(copy && fileExists);
          const isFileMissing = Boolean(copy && !fileExists);
          const isExpanded = expanded === resource.id;

          const typeIcon =
            resource.type === 'video'
              ? 'video'
              : resource.type === 'infografia'
                ? 'image'
                : 'file-text';

          return (
            <InfoCard key={resource.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${resource.title}, ${resource.type}`}
                onPress={() => setExpanded(isExpanded ? null : resource.id)}
              >
                <View style={styles.row}>
                  <Feather name={typeIcon} size={24} color={appTheme.colors.primary} />
                  <View style={styles.copy}>
                    <Text style={styles.heading}>{resource.title}</Text>
                    <BodyText>
                      {resource.type === 'video'
                        ? 'Video online (YouTube)'
                        : resource.type === 'infografia'
                          ? 'Infografía descargable'
                          : 'Guía de lectura'}
                      {resource.estimatedReadTimeMinutes
                        ? ` · ~${resource.estimatedReadTimeMinutes} min`
                        : ''}
                    </BodyText>
                  </View>
                  <Feather
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color={appTheme.colors.text}
                  />
                </View>
              </Pressable>

              <View style={styles.noticeBox}>
                <StatusPill>
                  {resource.type === 'video'
                    ? interaction?.revisionDeclaradaEn
                      ? `Revisado el ${formatDate(interaction.revisionDeclaradaEn)}`
                      : interaction
                        ? 'Video abierto (pendiente de confirmar)'
                        : 'Disponible online'
                    : isDownloaded
                      ? copy?.revisionDeclarada
                        ? `Revisado el ${copy.revisionDeclaradaEn ? formatDate(copy.revisionDeclaradaEn) : 'sí'}`
                        : 'Guardado en disco'
                      : isFileMissing
                        ? 'Archivo no disponible'
                        : 'Disponible para descarga'}
                </StatusPill>
              </View>

              {isExpanded ? (
                <View style={styles.stack}>
                  <BodyText>{resource.description}</BodyText>
                  <VisualButton
                    label="Ver detalle completo"
                    secondary
                    onPress={() =>
                      router.navigate(
                        '/educacion/recurso?recurso=' + encodeURIComponent(resource.id),
                      )
                    }
                  />
                </View>
              ) : null}
            </InfoCard>
          );
        })
      )}
    </Screen>
  );
}

export function EducationResourceScreen() {
  const { theme: appTheme } = useAppTheme();
  const { patientId, repository, runSave, saving, database } = useLocalData();
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

  if (loadingResource) {
    return (
      <Screen title="Cargando recurso" backTo="/educacion">
        <DemoBadge />
        <BodyText>Obteniendo información del recurso educativo…</BodyText>
      </Screen>
    );
  }

  if (!resource) {
    return (
      <Screen title="Recurso no encontrado" backTo="/educacion">
        <DemoBadge />
        <EmptyState
          icon="alert-circle"
          title="Recurso no disponible"
          description="No se encontró el material educativo solicitado en el catálogo."
        />
      </Screen>
    );
  }

  const localCopy = statusData?.copy;
  const interaction = statusData?.interaction;

  const fileExists =
    patientId && localCopy?.rutaRelativa
      ? resourceFileExists(patientId, resource.id, localCopy.rutaRelativa)
      : false;
  const isDownloaded = Boolean(localCopy && fileExists && localCopy.estado !== 'error');
  const isFileMissing = Boolean(localCopy && (!fileExists || localCopy.estado === 'error'));
  const busy = actionBusy || saving;

  // Lógica de apertura externa para videos de YouTube con comprobación de red
  async function handleOpenYouTube() {
    if (!repository || !patientId || !resource?.youtubeVideoId || busy) return;
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

      // Registrar interacción de apertura en SQLite
      await repository.education.recordYouTubeInteraction({
        contentId: resource.id,
        youtubeVideoId: resource.youtubeVideoId,
        versionOrigen: resource.version,
      });

      const launchResult = await launchYouTubeVideo(resource.youtubeVideoId);
      if (!launchResult.success) {
        setOpError(launchResult.error || 'No se pudo abrir YouTube en este dispositivo.');
      }
      refreshStatus();
    } catch {
      setOpError('Error al iniciar la apertura externa de YouTube.');
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  // Declarar video de YouTube como revisado
  async function handleDeclareYouTubeReviewed() {
    if (!repository || !patientId || !resource?.youtubeVideoId || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      await runSave(async () => {
        const res = await repository.education.declareYouTubeReviewed({
          contentId: resource.id,
          youtubeVideoId: resource.youtubeVideoId!,
          versionOrigen: resource.version,
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

  // Guardar copia local offline (Guía o Infografía) sin fallbacks corruptos
  async function handleSaveOfflineCopy() {
    if (!repository || !patientId || !resource || busy || !database) return;
    setActionBusy(true);
    setOpError(null);

    try {
      await runSave(async () => {
        let contentToSave: string | Uint8Array;
        let mimeType = 'text/markdown';
        const formato = resource.type === 'infografia' ? 'png' : 'markdown';

        if (resource.type === 'infografia') {
          mimeType = 'image/png';
          const assetKey = resource.asset?.type === 'bundled' ? resource.asset.assetKey : '';
          const assetModule = BUNDLED_ASSETS[assetKey];

          if (!assetModule) {
            throw new Error(
              'El archivo de la infografía no se encuentra empaquetado en este dispositivo.',
            );
          }

          const [loadedAsset] = await Asset.loadAsync(assetModule);
          const sourceUri = loadedAsset?.localUri;
          if (!sourceUri) {
            throw new Error(
              'No se pudo resolver la ruta local de la infografía empaquetada. Se cancela la operación para conservar la integridad del almacenamiento.',
            );
          }

          const fileObj = new File(sourceUri);
          contentToSave = await fileObj.bytes();
        } else {
          contentToSave =
            resource.contentMarkdown ?? `# ${resource.title}\n\nContenido de muestra.`;
        }

        // Coordinar guardado seguro con compensación atómica
        await saveEducationalMediaWithCompensation({
          pacienteId: patientId,
          contenidoId: resource.id,
          formato,
          content: contentToSave,
          versionOrigen: resource.version,
          mimeType,
          titulo: resource.title,
          tipo: resource.type,
          descripcion: resource.description,
          persistCopyInTx: async (params) => {
            // Guardar dentro de transacción de SQLite
            await database.transaction(async (tx: SqlConnection) => {
              await repository.education.persistCopyInTx(tx, {
                contentId: resource.id,
                rutaLocal: params.rutaLocal,
                formato: params.formato,
                tamanoBytes: params.tamanoBytes,
                nowIso: new Date().toISOString(),
                metadataLocal: params.metadataLocal,
              });
            });
          },
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

  // Declarar copia local como revisada
  async function handleDeclareCopyReviewed() {
    if (!repository || !patientId || !resource || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      await runSave(async () => {
        await repository.education.declareCopyReviewed(resource.id);
      });
      refreshStatus();
    } catch {
      setOpError('No se pudo registrar la revisión de la copia local.');
    } finally {
      if (isMountedRef.current) setActionBusy(false);
    }
  }

  // Eliminar copia local con verificación física previa
  async function handleDeleteCopy() {
    if (!repository || !patientId || !resource || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      await runSave(async () => {
        if (localCopy?.rutaRelativa) {
          const physicallyDeleted = await deleteResourceFile(
            patientId,
            resource.id,
            localCopy.rutaRelativa,
          );
          if (!physicallyDeleted) {
            throw new Error(
              'No se pudo confirmar la eliminación física del archivo del almacenamiento local.',
            );
          }
        }
        await repository.education.removeLocalCopy(resource.id);
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

  // Leer guía de texto
  async function handleReadGuide() {
    if (!patientId || !resource || busy) return;
    setActionBusy(true);
    setOpError(null);

    try {
      const text = await readResourceFile(patientId, resource.id, localCopy?.rutaRelativa);
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
    <Screen title={resource.title} backTo="/educacion">
      <DemoBadge />

      <InfoCard>
        <SectionTitle>{resource.title}</SectionTitle>
        <BodyText>{resource.description}</BodyText>
        <BodyText>Categoría: {resource.categoryName}</BodyText>
        {resource.estimatedReadTimeMinutes ? (
          <BodyText>Tiempo estimado: ~{resource.estimatedReadTimeMinutes} minutos</BodyText>
        ) : null}
      </InfoCard>

      <InfoCard>
        <SectionTitle>Estado en este dispositivo</SectionTitle>
        <StatusPill>
          {resource.type === 'video'
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

        {resource.type === 'video' ? (
          <View style={styles.noticeBox}>
            <Feather name="info" size={18} color={appTheme.colors.primary} />
            <Text style={styles.noticeText}>
              Los videos educativos se abren externamente en YouTube y requieren conexión activa. No
              se descargan videos al almacenamiento local.
            </Text>
          </View>
        ) : null}
      </InfoCard>

      {/* Visor de infografía (PNG) con control onLoad/onError */}
      {resource.type === 'infografia' && isDownloaded && localCopy?.rutaRelativa ? (
        <InfoCard>
          <SectionTitle>Infografía guardada en disco</SectionTitle>
          <Image
            source={{ uri: localCopy.rutaRelativa }}
            style={styles.infographicImage}
            resizeMode="contain"
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
            <View style={styles.imageLoadingBox}>
              <Feather name="alert-triangle" size={18} color={appTheme.colors.error} />
              <BodyText style={{ color: appTheme.colors.error }}>
                No se pudo renderizar la infografía desde el almacenamiento local. El archivo podría
                estar dañado o no ser compatible.
              </BodyText>
            </View>
          ) : !imageLoaded ? (
            <View style={styles.imageLoadingBox}>
              <ActivityIndicator color={appTheme.colors.primary} />
              <BodyText>Cargando visualización de imagen…</BodyText>
            </View>
          ) : null}
          <BodyText>
            {Math.max(1, Math.round(localCopy.tamanoBytes / 1024))} KB · SHA-256:{' '}
            {localCopy.metadataLocal?.sha256?.slice(0, 16)}…
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
      {resource.type === 'video' ? (
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
          {resource.type === 'guia' ? (
            <VisualButton
              label={readingContent ? 'Cerrar lectura' : 'Leer recurso sin conexión'}
              disabled={busy}
              onPress={
                readingContent ? () => setReadingContent(null) : () => void handleReadGuide()
              }
            />
          ) : null}

          {/* Para infografías: botón deshabilitado hasta que la imagen haya terminado de cargar sin errores */}
          {!localCopy?.revisionDeclarada ? (
            <VisualButton
              label={busy ? 'Confirmando…' : 'Declarar material revisado'}
              disabled={
                busy || (resource.type === 'infografia' && (!imageLoaded || imageLoadError))
              }
              onPress={() => void handleDeclareCopyReviewed()}
            />
          ) : null}

          <VisualButton
            label={busy ? 'Eliminando…' : 'Eliminar copia local'}
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
            label={busy ? 'Eliminando…' : 'Eliminar registro'}
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
              : resource.type === 'infografia'
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
    <Screen title="Estado de biblioteca" backTo="/educacion">
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
  });
}
