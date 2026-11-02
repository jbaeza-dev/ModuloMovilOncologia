import { clinicalStatusLabel } from '../../data/sync/visible-status';
import { useCallback } from 'react';
import { router } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { formatDate, type SymptomWithSyncRecord } from '../../data/local/repository';
import { useFocusedList } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { theme } from '../../theme';

export function SymptomDataScreen() {
  const { repository } = useLocalData();
  const load = useCallback(
    (offset: number) => (repository ? repository.symptoms(30, offset) : Promise.resolve([])),
    [repository],
  );
  const list = useFocusedList(load);

  return (
    <Screen mascotPose="resumen" title="Historial de síntomas libres" scroll={false}>
      <FlatList<SymptomWithSyncRecord>
        data={list.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <InfoCard>
            <SectionTitle>{formatDate(item.fecha_registro)}</SectionTitle>
            <BodyText>{item.descripcion}</BodyText>
            <StatusPill>{clinicalStatusLabel(item.estado_envio)}</StatusPill>
          </InfoCard>
        )}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.stack}>
            <BodyText>
              Se conservan tus registros libres anteriores. Para registrar nuevos síntomas, utiliza
              el cuestionario de seguimiento.
            </BodyText>
            <VisualButton
              label="Abrir seguimiento ePRO"
              onPress={() => router.push('/formulario')}
            />
            <SectionTitle>Mi historial</SectionTitle>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={list.error ? 'alert-circle' : list.loading ? 'clock' : 'clipboard'}
            title={
              list.error
                ? 'No se pudo leer el historial'
                : list.loading
                  ? 'Cargando síntomas'
                  : 'Aún no hay síntomas guardados'
            }
            description={list.error ? 'Vuelve a intentarlo.' : 'Tus descripciones aparecerán aquí.'}
          />
        }
        ListFooterComponent={
          <View style={styles.stack}>
            {list.error ? <VisualButton label="Reintentar" onPress={list.refresh} /> : null}
            {list.hasMore ? (
              <VisualButton
                label={list.loadingMore ? 'Cargando…' : 'Cargar más'}
                secondary
                disabled={list.loadingMore}
                onPress={() => void list.loadMore()}
              />
            ) : null}
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  stack: { gap: theme.spacing.md },
});
