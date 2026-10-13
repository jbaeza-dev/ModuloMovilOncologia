import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  EmptyState,
  InfoCard,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import type { EducationalLocalCopy } from '../../data/local/education/education-types';
import { deleteResourceFile, resourceFileExists } from '../../data/local/files/resource-storage';
import { formatDate } from '../../data/local/repository';
import { useFocusedList } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

export function EducationCopiesScreen() {
  const { theme: appTheme } = useAppTheme();
  const { patientId, repository, runSave, saving } = useLocalData();
  const styles = useStyles();

  const [filterFormat, setFilterFormat] = useState<'all' | 'markdown' | 'png'>('all');
  const [actionBusy, setActionBusy] = useState(false);

  const loadCopies = useCallback(async (): Promise<EducationalLocalCopy[]> => {
    if (!repository || !patientId) return [];
    return repository.education.listLocalCopies();
  }, [repository, patientId]);

  const { items: copies, loading, error, refresh } = useFocusedList(loadCopies);

  const filteredCopies = copies.filter((copy) => {
    if (filterFormat === 'all') return true;
    return copy.formato === filterFormat;
  });

  async function handleDeclareReviewed(contentId: string) {
    if (!repository || actionBusy || saving) return;
    setActionBusy(true);
    try {
      await runSave(async () => {
        await repository.education.declareCopyReviewed(contentId);
      });
      refresh();
    } catch {
      Alert.alert('Error', 'No se pudo actualizar el estado de revisión.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteCopy(copy: EducationalLocalCopy) {
    if (!repository || !patientId || actionBusy || saving) return;
    setActionBusy(true);
    try {
      await runSave(async () => {
        if (copy.rutaRelativa) {
          const physicallyDeleted = await deleteResourceFile(
            patientId,
            copy.contentId,
            copy.rutaRelativa,
          );
          if (!physicallyDeleted) {
            throw new Error(
              'No se pudo confirmar la eliminación física del archivo del almacenamiento local.',
            );
          }
        }
        await repository.education.removeLocalCopy(copy.contentId);
      });
      refresh();
    } catch {
      Alert.alert('Error', 'No se pudo eliminar la copia local del dispositivo.');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <Screen title="Mis copias guardadas" backTo="/educacion">
      <DemoBadge />
      <BodyText>Archivos descargados en almacenamiento privado para lectura sin conexión.</BodyText>

      {/* Selector de filtros por formato */}
      <View style={styles.filterRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Todas las copias"
          onPress={() => setFilterFormat('all')}
          style={[styles.filterChip, filterFormat === 'all' && styles.filterChipActive]}
        >
          <Text style={[styles.filterText, filterFormat === 'all' && styles.filterTextActive]}>
            Todas ({copies.length})
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filtrar por guías de texto"
          onPress={() => setFilterFormat('markdown')}
          style={[styles.filterChip, filterFormat === 'markdown' && styles.filterChipActive]}
        >
          <Text style={[styles.filterText, filterFormat === 'markdown' && styles.filterTextActive]}>
            Guías ({copies.filter((c) => c.formato === 'markdown').length})
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filtrar por infografías"
          onPress={() => setFilterFormat('png')}
          style={[styles.filterChip, filterFormat === 'png' && styles.filterChipActive]}
        >
          <Text style={[styles.filterText, filterFormat === 'png' && styles.filterTextActive]}>
            Infografías ({copies.filter((c) => c.formato === 'png').length})
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <BodyText>Consultando copias locales…</BodyText>
      ) : error ? (
        <InfoCard>
          <Text style={styles.errorText}>No se pudieron consultar las copias locales.</Text>
          <VisualButton label="Reintentar" secondary onPress={refresh} />
        </InfoCard>
      ) : filteredCopies.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Sin copias en este filtro"
          description="Descarga guías o infografías desde la biblioteca para consultarlas fuera de línea."
        />
      ) : (
        filteredCopies.map((copy) => {
          const title = copy.titulo ?? copy.metadataLocal?.titulo ?? copy.contentId;
          const kb = Math.max(1, Math.round(copy.tamanoBytes / 1024));
          const isImage = copy.formato === 'png' || copy.formato === 'jpeg';
          const fileExists =
            patientId && copy.rutaRelativa
              ? resourceFileExists(patientId, copy.contentId, copy.rutaRelativa)
              : false;
          const isErrorState = copy.estado === 'error' || !fileExists;

          return (
            <InfoCard key={copy.contentId}>
              <View style={styles.cardHeader}>
                <Feather
                  name={isImage ? 'image' : 'file-text'}
                  size={24}
                  color={isErrorState ? appTheme.colors.error : appTheme.colors.primary}
                />
                <View style={styles.cardTitleBox}>
                  <Text style={styles.cardTitle}>{title}</Text>
                  <BodyText>
                    {copy.formato.toUpperCase()} · {kb} KB ·{' '}
                    {copy.descargadoEn ? `Guardado ${formatDate(copy.descargadoEn)}` : 'Sin fecha'}
                  </BodyText>
                </View>
              </View>

              <View style={styles.statusBox}>
                {isErrorState ? (
                  <StatusPill variant="danger">
                    {copy.estado === 'error' ? 'Error al guardar' : 'Archivo no disponible'}
                  </StatusPill>
                ) : (
                  <StatusPill>
                    {copy.revisionDeclarada
                      ? `Revisada el ${copy.revisionDeclaradaEn ? formatDate(copy.revisionDeclaradaEn) : 'sí'}`
                      : 'Pendiente de revisar'}
                  </StatusPill>
                )}
              </View>

              <View style={styles.actionsRow}>
                {isErrorState ? (
                  <>
                    <VisualButton
                      label="Reintentar descarga"
                      onPress={() =>
                        router.push(
                          '/educacion/recurso?recurso=' + encodeURIComponent(copy.contentId),
                        )
                      }
                    />
                    <VisualButton
                      label="Eliminar registro"
                      secondary
                      disabled={actionBusy || saving}
                      onPress={() => void handleDeleteCopy(copy)}
                    />
                  </>
                ) : (
                  <>
                    <VisualButton
                      label={isImage ? 'Ver infografía' : 'Leer guía'}
                      secondary
                      onPress={() =>
                        router.push(
                          '/educacion/recurso?recurso=' + encodeURIComponent(copy.contentId),
                        )
                      }
                    />
                    {!copy.revisionDeclarada ? (
                      isImage ? (
                        <VisualButton
                          label="Abrir para revisar"
                          onPress={() =>
                            router.push(
                              '/educacion/recurso?recurso=' + encodeURIComponent(copy.contentId),
                            )
                          }
                        />
                      ) : (
                        <VisualButton
                          label="Marcar revisada"
                          disabled={actionBusy || saving}
                          onPress={() => void handleDeclareReviewed(copy.contentId)}
                        />
                      )
                    ) : null}
                    <VisualButton
                      label="Eliminar"
                      secondary
                      disabled={actionBusy || saving}
                      onPress={() => void handleDeleteCopy(copy)}
                    />
                  </>
                )}
              </View>
            </InfoCard>
          );
        })
      )}
    </Screen>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  return StyleSheet.create({
    filterRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.sm,
    },
    filterChip: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: 999,
      backgroundColor: appTheme.colors.surface,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
    },
    filterChipActive: {
      backgroundColor: appTheme.colors.primary,
      borderColor: appTheme.colors.primary,
    },
    filterText: {
      fontSize: 13,
      fontWeight: '600',
      color: appTheme.colors.text,
    },
    filterTextActive: {
      color: '#FFFFFF',
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    cardTitleBox: {
      flex: 1,
      gap: 2,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: appTheme.colors.text,
    },
    statusBox: {
      flexDirection: 'row',
      marginTop: theme.spacing.xs,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
      flexWrap: 'wrap',
    },
    errorText: {
      color: appTheme.colors.error,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: theme.spacing.sm,
    },
  });
}
