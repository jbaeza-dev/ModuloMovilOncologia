import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
import type { DownloadRecord } from '../../data/local/repository';
import {
  deleteFileByUri,
  deleteResourceFile,
  readResourceFile,
  reconcileResourceCopies,
  resourceFileExists,
  saveResourceWithCompensation,
} from '../../data/local/resource-storage';
import { useFocusedList, useFocusedValue } from '../../data/local/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { educationCategories, educationResources } from '../preview/fixtures';

export function EducationScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  return (
    <Screen title="Contenido educativo">
      <DemoBadge />
      <BodyText>Biblioteca de muestra sobre quimioterapia.</BodyText>
      {educationCategories.map((category, index) => (
        <Pressable
          key={category.title}
          accessibilityRole="button"
          accessibilityLabel={category.title}
          onPress={() => router.navigate('/educacion/categoria?categoria=' + String(index))}
          style={styles.row}
        >
          <Feather name={category.icon} size={30} color={appTheme.colors.primary} />
          <View style={styles.copy}>
            <Text style={styles.heading}>{category.title}</Text>
            <BodyText>{category.count}</BodyText>
          </View>
          <Feather name="chevron-right" size={22} color={appTheme.colors.text} />
        </Pressable>
      ))}
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
  const resources = educationResources.filter((resource) => resource.category === categoryIndex);

  const loadDownloads = useCallback(async () => {
    if (!repository || !patientId) return [];
    await reconcileResourceCopies(patientId, repository).catch(() => undefined);
    return repository.downloads();
  }, [repository, patientId]);
  const {
    items: downloads,
    loading: loadingDownloads,
    error: downloadsError,
  } = useFocusedList(loadDownloads);
  const downloadRecordMap = new Map(downloads.map((d) => [d.contenido_id, d]));

  return (
    <Screen title={educationCategories[categoryIndex].title} backTo="/educacion">
      <DemoBadge />
      <BodyText>
        Material de muestra neutro para demostración técnica del almacenamiento local.
      </BodyText>
      {resources.map((resource) => {
        const record = downloadRecordMap.get(resource.id);
        const fileExists = patientId
          ? resourceFileExists(patientId, resource.id, record?.ruta_local)
          : false;
        const isDownloaded = record?.estado === 'descargado' && fileExists;
        const isFileMissing = Boolean(record && (record.estado === 'error' || !fileExists));
        return (
          <InfoCard key={resource.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'Ver descripción de ' + resource.title}
              accessibilityState={{ expanded: expanded === resource.id }}
              onPress={() => setExpanded(expanded === resource.id ? null : resource.id)}
              style={styles.row}
            >
              <Feather name="file-text" size={26} color={appTheme.colors.primary} />
              <View style={styles.copy}>
                <Text style={styles.heading}>{resource.title}</Text>
                <BodyText>
                  {resource.type} · {resource.duration}
                </BodyText>
              </View>
              <Feather
                name={expanded === resource.id ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={appTheme.colors.text}
              />
            </Pressable>
            {expanded === resource.id ? (
              <View style={styles.stack}>
                <BodyText>
                  Descripción de muestra para demostración técnica de persistencia de archivos.
                </BodyText>
                <StatusPill>
                  {loadingDownloads
                    ? 'Comprobando…'
                    : downloadsError
                      ? 'Estado no disponible'
                      : isDownloaded
                        ? 'Disponible sin conexión'
                        : isFileMissing
                          ? 'Archivo ausente en dispositivo'
                          : resource.state}
                </StatusPill>
                <VisualButton
                  label="Ver detalle"
                  secondary
                  onPress={() =>
                    router.navigate('/educacion/recurso?recurso=' + encodeURIComponent(resource.id))
                  }
                />
              </View>
            ) : null}
          </InfoCard>
        );
      })}
    </Screen>
  );
}

export function EducationResourceScreen() {
  const { theme: appTheme } = useAppTheme();
  const { patientId, repository, runSave, saving } = useLocalData();
  const styles = useStyles();
  const { recurso } = useLocalSearchParams<{ recurso?: string }>();
  const resource =
    educationResources.find((r) => r.id === recurso) ??
    (Number.isInteger(Number(recurso)) ? educationResources[Number(recurso)] : null);

  const loadDownload = useCallback(async () => {
    if (!repository || !patientId || !resource) return null;
    await reconcileResourceCopies(patientId, repository).catch(() => undefined);
    return repository.download(resource.id);
  }, [repository, patientId, resource]);
  const {
    value: downloadRecord,
    loading: loadingDownload,
    error: downloadError,
    refresh: refreshDownload,
  } = useFocusedValue(loadDownload, null as DownloadRecord | null);

  const [readingContent, setReadingContent] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  if (!resource) {
    return (
      <Screen title="Recurso no encontrado" backTo="/educacion">
        <DemoBadge />
        <EmptyState
          icon="alert-circle"
          title="Recurso no disponible"
          description="No se encontró el recurso educativo solicitado."
        />
      </Screen>
    );
  }

  const fileExists = patientId
    ? resourceFileExists(patientId, resource.id, downloadRecord?.ruta_local)
    : false;
  const isDownloaded = downloadRecord?.estado === 'descargado' && fileExists;
  const isFileMissing = Boolean(
    downloadRecord && (downloadRecord.estado === 'error' || !fileExists),
  );
  const busy = actionBusy || saving;

  async function handleSave() {
    if (!repository || !patientId || !resource || busy) return;
    setActionBusy(true);
    setOpError(null);
    try {
      await runSave(async () => {
        const previousDownload = await repository.download(resource.id);
        const previousPath = previousDownload?.ruta_local;

        await saveResourceWithCompensation(
          patientId,
          resource.id,
          resource.content,
          async (finalUri: string) => {
            await repository.saveDownload({
              contenido_id: resource.id,
              ruta_local: finalUri,
            });
            if (previousPath && previousPath !== finalUri) {
              await deleteFileByUri(previousPath).catch(() => false);
            }
          },
        );
      });
      refreshDownload();
    } catch {
      setOpError('No se pudo guardar la copia sin conexión en el dispositivo.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete() {
    if (!repository || !patientId || !resource || busy) return;
    setActionBusy(true);
    setOpError(null);
    try {
      await runSave(async () => {
        const current = await repository.download(resource.id);
        const fileDeleted = await deleteResourceFile(patientId, resource.id, current?.ruta_local);
        if (!fileDeleted) {
          throw new Error('No se pudo eliminar el archivo local en el dispositivo.');
        }
        await repository.removeDownload(resource.id);
      });
      setReadingContent(null);
      refreshDownload();
    } catch {
      setOpError(
        'No se pudo eliminar el archivo local en el dispositivo. Se conserva el registro.',
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRead() {
    if (!patientId || !resource) return;
    setOpError(null);
    try {
      const content = await readResourceFile(patientId, resource.id, downloadRecord?.ruta_local);
      if (content !== null) {
        setReadingContent(content);
        if (repository) {
          await repository.markDownloadViewed(resource.id).catch(() => undefined);
          refreshDownload();
        }
      } else {
        setOpError('El archivo físico no se encuentra en el dispositivo.');
      }
    } catch {
      setOpError('No se pudo leer el archivo local del dispositivo.');
    }
  }

  return (
    <Screen title={resource.title} backTo="/educacion">
      <DemoBadge />
      {downloadError ? (
        <InfoCard>
          <Text accessibilityRole="alert" style={styles.errorText}>
            No se pudo consultar el estado de la copia local.
          </Text>
          <VisualButton label="Reintentar consulta" secondary onPress={refreshDownload} />
        </InfoCard>
      ) : null}
      <InfoCard>
        <View style={styles.placeholder}>
          <Feather
            name={resource.type === 'Video' ? 'play-circle' : 'file-text'}
            size={60}
            color={appTheme.colors.primary}
          />
        </View>
        <SectionTitle>
          {resource.type} · {resource.duration}
        </SectionTitle>
        <StatusPill>
          {loadingDownload
            ? 'Comprobando disponibilidad…'
            : downloadError
              ? 'Estado no disponible'
              : isDownloaded
                ? 'Disponible sin conexión'
                : isFileMissing
                  ? 'Archivo ausente en dispositivo'
                  : 'Disponible para guardar'}
        </StatusPill>
        <BodyText>
          Material de muestra neutro para demostración técnica del almacenamiento local de archivos
          en este dispositivo.
        </BodyText>
        {!loadingDownload && !downloadError && downloadRecord?.visualizada ? (
          <BodyText>Lectura local registrada en el dispositivo.</BodyText>
        ) : null}
      </InfoCard>

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

      {downloadError ? null : loadingDownload ? (
        <BodyText>Comprobando almacenamiento local…</BodyText>
      ) : isDownloaded ? (
        <>
          <VisualButton
            label={readingContent ? 'Cerrar lectura' : 'Leer recurso sin conexión'}
            disabled={busy}
            onPress={readingContent ? () => setReadingContent(null) : () => void handleRead()}
          />
          <VisualButton
            label={busy ? 'Eliminando…' : 'Eliminar copia local'}
            secondary
            disabled={busy}
            onPress={() => void handleDelete()}
          />
        </>
      ) : isFileMissing ? (
        <>
          <InfoCard>
            <SectionTitle>Archivo no disponible</SectionTitle>
            <BodyText>
              La copia física de este recurso no se encuentra en el almacenamiento local. Puedes
              reintentar la descarga o eliminar el registro del dispositivo.
            </BodyText>
          </InfoCard>
          <VisualButton
            label={busy ? 'Descargando…' : 'Reintentar descarga'}
            disabled={busy || !repository}
            onPress={() => void handleSave()}
          />
          <VisualButton
            label={busy ? 'Eliminando…' : 'Eliminar registro'}
            secondary
            disabled={busy || !repository}
            onPress={() => void handleDelete()}
          />
        </>
      ) : (
        <VisualButton
          label={busy ? 'Guardando copia…' : 'Guardar copia sin conexión'}
          disabled={busy || !repository}
          onPress={() => void handleSave()}
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
    errorText: { color: appTheme.colors.error, fontSize: 14, fontWeight: '600' },
  });
}
