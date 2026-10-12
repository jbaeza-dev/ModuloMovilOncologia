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
import { deleteResourceFile } from '../../data/local/files/resource-storage';
import { formatDate } from '../../data/local/repository';
import { useFocusedList } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { SAMPLE_EDUCATIONAL_CATALOG } from './sample-education-catalog';

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

  const catalogMap = new Map(SAMPLE_EDUCATIONAL_CATALOG.map((c) => [c.id, c]));

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
        await deleteResourceFile(patientId, copy.contentId, copy.rutaRelativa);
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
          const resource = catalogMap.get(copy.contentId);
          const title = resource?.title ?? copy.contentId;
          const kb = Math.max(1, Math.round(copy.tamanoBytes / 1024));

          return (
            <InfoCard key={copy.contentId}>
              <View style={styles.cardHeader}>
                <Feather
                  name={copy.formato === 'png' ? 'image' : 'file-text'}
                  size={24}
                  color={appTheme.colors.primary}
                />
                <View style={styles.cardTitleBox}>
                  <Text style={styles.cardTitle}>{title}</Text>
                  <BodyText>
                    {copy.formato.toUpperCase()} · {kb} KB · Guardado{' '}
                    {formatDate(copy.descargadoEn)}
                  </BodyText>
                </View>
              </View>

              <View style={styles.statusBox}>
                <StatusPill>
                  {copy.revisionDeclarada
                    ? `Revisada el ${copy.revisionDeclaradaEn ? formatDate(copy.revisionDeclaradaEn) : 'sí'}`
                    : 'Pendiente de revisar'}
                </StatusPill>
              </View>

              <View style={styles.actionsRow}>
                <VisualButton
                  label="Abrir"
                  secondary
                  onPress={() =>
                    router.navigate(
                      '/educacion/recurso?recurso=' + encodeURIComponent(copy.contentId),
                    )
                  }
                />
                {!copy.revisionDeclarada ? (
                  <VisualButton
                    label="Marcar revisada"
                    disabled={actionBusy || saving}
                    onPress={() => void handleDeclareReviewed(copy.contentId)}
                  />
                ) : null}
                <VisualButton
                  label="Eliminar"
                  secondary
                  disabled={actionBusy || saving}
                  onPress={() => void handleDeleteCopy(copy)}
                />
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
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
    },
    cardTitleBox: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: appTheme.colors.text,
    },
    statusBox: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    actionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    errorText: {
      color: appTheme.colors.error,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
