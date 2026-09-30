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
  deleteResourceFile,
  readResourceFile,
  resourceFileExists,
  writeResourceFile,
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

  const loadDownloads = useCallback(
    () => (repository ? repository.downloads() : Promise.resolve([])),
    [repository],
  );
  const { items: downloads } = useFocusedList(loadDownloads);
  const downloadedIds = new Set(
    downloads.filter((d) => d.estado === 'descargado').map((d) => d.contenido_id),
  );

  return (
    <Screen title={educationCategories[categoryIndex].title} backTo="/educacion">
      <DemoBadge />
      <BodyText>
        Material de muestra neutro para demostración técnica del almacenamiento local.
      </BodyText>
      {resources.map((resource) => {
        const isDownloaded =
          downloadedIds.has(resource.id) &&
          (patientId ? resourceFileExists(patientId, resource.id) : false);
        return (
          <InfoCard key={resource.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'Ver descripción de ' + resource.title}
              accessibilityState={{ expanded: expanded === resource.id }}
              onPress={() => setExpanded(expanded === resource.id ? null : resource.id)}
              style={styles.row}
            >
              <Feather
                name={resource.type === 'Video' ? 'play' : 'file-text'}
                size={26}
                color={appTheme.colors.primary}
              />
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
                <StatusPill>{isDownloaded ? 'Disponible sin conexión' : resource.state}</StatusPill>
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

  const loadDownload = useCallback(
    () => (repository && resource ? repository.download(resource.id) : Promise.resolve(null)),
    [repository, resource],
  );
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

  const fileExists = patientId ? resourceFileExists(patientId, resource.id) : false;
  const isDownloaded = downloadRecord?.estado === 'descargado' && fileExists;
  const busy = actionBusy || saving;

  async function handleSave() {
    if (!repository || !patientId || !resource || busy) return;
    setActionBusy(true);
    setOpError(null);
    try {
      await runSave(async () => {
        const filePath = await writeResourceFile(patientId, resource.id, resource.content);
        try {
          await repository.saveDownload({
            contenido_id: resource.id,
            ruta_local: filePath,
          });
        } catch (dbErr) {
          await deleteResourceFile(patientId, resource.id).catch(() => undefined);
          throw dbErr;
        }
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
        // El borrado físico debe ejecutarse sin silenciar fallos.
        // Si falla, no se borra la fila SQLite y se informa el error.
        await deleteResourceFile(patientId, resource.id);
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
      const content = await readResourceFile(patientId, resource.id);
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
      {loadingDownload ? <BodyText>Comprobando almacenamiento local…</BodyText> : null}
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
          {isDownloaded ? 'Disponible sin conexión' : 'Disponible para guardar'}
        </StatusPill>
        <BodyText>
          Material de muestra neutro para demostración técnica del almacenamiento local de archivos
          en este dispositivo.
        </BodyText>
        {downloadRecord?.visualizada ? (
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

      {isDownloaded ? (
        <>
          <VisualButton
            label={readingContent ? 'Cerrar lectura' : 'Leer recurso sin conexión'}
            onPress={readingContent ? () => setReadingContent(null) : () => void handleRead()}
          />
          <VisualButton
            label={busy ? 'Eliminando…' : 'Eliminar copia local'}
            secondary
            disabled={busy}
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
