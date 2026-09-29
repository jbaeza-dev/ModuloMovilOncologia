import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { formatDate, type SymptomWithSyncRecord } from '../../data/local/repository';
import { useFocusedList } from '../../data/local/use-local-query';
import { InputError, parseSymptomDescription } from '../../data/local/validation';
import { useLocalData } from '../../providers/LocalDataProvider';
import { theme } from '../../theme';

export function SymptomDataScreen() {
  const { repository, runSave, saving } = useLocalData();
  const [description, setDescription] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    (offset: number) => (repository ? repository.symptoms(30, offset) : Promise.resolve([])),
    [repository],
  );
  const list = useFocusedList(load);
  const busy = submitting || saving;

  function review() {
    setError(null);
    try {
      parseSymptomDescription(description);
      setConfirming(true);
      setSaved(false);
    } catch (failure) {
      if (failure instanceof InputError) setError(failure.message);
    }
  }

  async function save() {
    if (busy || !repository) return;
    setSubmitting(true);
    setError(null);
    try {
      const value = parseSymptomDescription(description);
      await runSave(() => repository.createSymptom(value));
      setDescription('');
      setConfirming(false);
      setSaved(true);
      list.refresh();
    } catch (failure) {
      setError(
        failure instanceof InputError
          ? failure.message
          : 'No se pudo guardar en este dispositivo. Intenta nuevamente.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen title="Síntomas de hoy" scroll={false}>
      <FlatList<SymptomWithSyncRecord>
        data={list.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <InfoCard>
            <SectionTitle>{formatDate(item.fecha_registro)}</SectionTitle>
            <BodyText>{item.descripcion}</BodyText>
            <StatusPill>
              {item.estado_envio === 'pendiente' || !item.estado_envio
                ? 'Pendiente de sincronización'
                : `Estado: ${item.estado_envio}`}
            </StatusPill>
          </InfoCard>
        )}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.stack}>
            <BodyText>Escribe una descripción libre. No se realiza evaluación clínica.</BodyText>
            {!confirming ? (
              <>
                <VisualField
                  label="Describe el síntoma"
                  value={description}
                  multiline
                  maxLength={2000}
                  onChangeText={(value) => {
                    setDescription(value);
                    setSaved(false);
                  }}
                  placeholder="Describe cómo te sientes"
                />
                <BodyText>{description.length}/2.000 caracteres</BodyText>
                <VisualButton
                  label="Revisar antes de guardar"
                  disabled={!repository || busy}
                  onPress={review}
                />
              </>
            ) : (
              <InfoCard>
                <SectionTitle>Revisa tu descripción</SectionTitle>
                <BodyText>{description.trim()}</BodyText>
                <VisualButton
                  label={busy ? 'Guardando…' : 'Confirmar guardado local'}
                  disabled={busy}
                  onPress={() => void save()}
                />
                <VisualButton
                  label="Editar"
                  secondary
                  disabled={busy}
                  onPress={() => setConfirming(false)}
                />
              </InfoCard>
            )}
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            {saved ? (
              <StatusPill>Guardado en este dispositivo · Pendiente de sincronización</StatusPill>
            ) : null}
            <SectionTitle>Historial local</SectionTitle>
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
            description={
              list.error ? 'Reintenta la consulta local.' : 'Tus descripciones aparecerán aquí.'
            }
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
