import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, StyleSheet, Text, View } from 'react-native';

import { NavigationCard } from '../../components/NavigationCard';
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
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import type {
  AssignedFormSummary,
  DailyFormStatus,
  FullFormDefinition,
} from '../../data/local/forms/form-repository';
import type { FormConfiguration, QuestionConfiguration } from '../../data/local/forms/form-types';
import { validateConditionIntegrity } from '../../services/forms/form-conditions';
import { parseDailyPeriodKey } from '../../services/forms/daily-form-context';

export function DailyFollowUpScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { repository, patientId, formStorageReady, trackOperation } = useLocalData();

  const runTracked = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      if (typeof trackOperation === 'function') {
        return trackOperation(operation);
      }
      return operation();
    },
    [trackOperation],
  );

  const [discardingOlder, setDiscardingOlder] = useState(false);

  const loadData = useCallback(async () => {
    if (!repository || !patientId || !formStorageReady) {
      return {
        assigned: [] as AssignedFormSummary[],
        dailyStatus: null as DailyFormStatus | null,
        mainForm: null as FullFormDefinition | null,
        isIncompatible: false,
      };
    }

    const assigned = await repository.listAssignedForms();
    if (assigned.length === 0) {
      return {
        assigned: [],
        dailyStatus: null,
        mainForm: null,
        isIncompatible: false,
      };
    }

    const primaryAssignment = assigned[0];
    const dailyStatus = await repository.getDailyFormStatus(primaryAssignment.formulario_id);
    const mainForm = await repository.getFormDefinition(
      primaryAssignment.formulario_id,
      primaryAssignment.version,
    );

    let isIncompatible = false;
    if (mainForm) {
      try {
        let configuracion: Record<string, unknown> | undefined;
        if (mainForm.configuracion_json) {
          configuracion = JSON.parse(mainForm.configuracion_json);
        }
        validateConditionIntegrity({
          formularioId: mainForm.formulario_id,
          version: mainForm.version,
          titulo: mainForm.titulo,
          descripcion: mainForm.descripcion,
          duracionEstimadaMin: mainForm.duracion_estimada_min,
          configuracion: configuracion as FormConfiguration,
          preguntas: mainForm.preguntas.map((q) => ({
            preguntaId: q.pregunta_id,
            texto: q.texto,
            descripcion: q.descripcion ?? undefined,
            tipo: q.tipo,
            orden: q.orden,
            requerida: q.requerida === 1,
            configuracion: q.configuracion as QuestionConfiguration,
          })),
        });
      } catch {
        isIncompatible = true;
      }
    }

    return {
      assigned,
      dailyStatus,
      mainForm,
      isIncompatible,
    };
  }, [repository, patientId, formStorageReady]);

  const { value, refresh } = useFocusedValue(loadData, {
    assigned: [] as AssignedFormSummary[],
    dailyStatus: null as DailyFormStatus | null,
    mainForm: null as FullFormDefinition | null,
    isIncompatible: false,
  });

  const { assigned, dailyStatus, mainForm, isIncompatible } = value;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refresh();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);

  const handleStartOrContinue = async () => {
    if (!mainForm || !repository) return;
    try {
      await runTracked(async () => {
        return repository.getOrCreateDailyDraft(mainForm.formulario_id, mainForm.version);
      });
      router.push({
        pathname: '/formulario/cuestionario',
        params: { id: mainForm.formulario_id, version: mainForm.version },
      });
    } catch (error) {
      Alert.alert(
        'Error al iniciar',
        error instanceof Error ? error.message : 'No se pudo iniciar el seguimiento.',
      );
    }
  };

  const handleDiscardOlderDraft = async (periodoClave: string) => {
    if (!repository || !mainForm) return;

    Alert.alert(
      'Descartar borrador anterior',
      '¿Deseas descartar las respuestas que no completaste en días anteriores?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descartar',
          style: 'destructive',
          onPress: async () => {
            setDiscardingOlder(true);
            try {
              await runTracked(async () => {
                await repository.discardDraft(
                  mainForm.formulario_id,
                  mainForm.version,
                  periodoClave,
                );
              });
              refresh();
            } catch (error) {
              Alert.alert(
                'Error',
                error instanceof Error ? error.message : 'No se pudo descartar el borrador.',
              );
            } finally {
              setDiscardingOlder(false);
            }
          },
        },
      ],
    );
  };

  const primaryAssigned = assigned[0];

  return (
    <Screen isRoot title="Cómo me siento hoy">
      <DemoBadge />
      <BodyText>
        Registro diario de síntomas y bienestar durante tu tratamiento. Tus respuestas quedan
        guardadas de forma segura en este dispositivo.
      </BodyText>

      {isIncompatible ? (
        <InfoCard>
          <View style={styles.incompatibleContainer}>
            <Feather
              name="alert-octagon"
              size={32}
              color={appTheme.colors.warning}
              accessible={false}
            />
            <Text style={styles.incompatibleTitle}>Cuestionario no compatible</Text>
            <BodyText>
              La definición del cuestionario asignado contiene reglas o tipos no compatibles con
              esta versión de la aplicación.
            </BodyText>
          </View>
        </InfoCard>
      ) : assigned.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="Sin cuestionarios asignados"
          description="Tu equipo tratante aún no ha asignado cuestionarios de seguimiento para tu perfil."
        />
      ) : (
        <>
          {/* Tarjeta de borrador de día anterior si existe */}
          {dailyStatus?.hasOlderDraft && dailyStatus.olderDraft ? (
            <InfoCard>
              <View style={styles.olderDraftCard}>
                <View style={styles.olderDraftHeader}>
                  <Feather
                    name="clock"
                    size={20}
                    color={appTheme.colors.warning}
                    accessible={false}
                  />
                  <Text style={styles.olderDraftTitle}>
                    Borrador pendiente del{' '}
                    {dailyStatus.olderDraft.fecha_seguimiento
                      ? formatDate(dailyStatus.olderDraft.fecha_seguimiento)
                      : parseDailyPeriodKey(dailyStatus.olderDraft.periodo_clave)?.fechaSeguimiento
                        ? formatDate(
                            parseDailyPeriodKey(dailyStatus.olderDraft.periodo_clave)!
                              .fechaSeguimiento,
                          )
                        : 'día anterior'}
                  </Text>
                </View>
                <BodyText>
                  Dejaste un registro sin terminar. Puedes continuar con él o descartarlo para
                  comenzar el seguimiento de hoy.
                </BodyText>
                <View style={styles.olderDraftActions}>
                  <VisualButton
                    label="Continuar borrador anterior"
                    secondary
                    onPress={() => {
                      router.push({
                        pathname: '/formulario/cuestionario',
                        params: {
                          id: dailyStatus.olderDraft!.formulario_id,
                          version: dailyStatus.olderDraft!.version,
                          periodoClave: dailyStatus.olderDraft!.periodo_clave,
                        },
                      });
                    }}
                  />
                  <VisualButton
                    label="Descartar borrador anterior"
                    secondary
                    disabled={discardingOlder}
                    onPress={() => handleDiscardOlderDraft(dailyStatus.olderDraft!.periodo_clave)}
                  />
                </View>
              </View>
            </InfoCard>
          ) : null}

          {/* Tarjeta principal de seguimiento de hoy */}
          <InfoCard>
            <View style={styles.todayCard}>
              <View style={styles.todayHeader}>
                <View style={styles.todayTitleRow}>
                  <Feather
                    name="heart"
                    size={24}
                    color={appTheme.colors.primary}
                    accessible={false}
                  />
                  <Text style={styles.todayTitle}>
                    {primaryAssigned?.titulo ?? 'Seguimiento diario'}
                  </Text>
                </View>
                {dailyStatus?.hasSubmittedToday ? (
                  <StatusPill>Completado hoy</StatusPill>
                ) : dailyStatus?.hasActiveDraft ? (
                  <StatusPill>En progreso</StatusPill>
                ) : (
                  <StatusPill>Pendiente de hoy</StatusPill>
                )}
              </View>

              <BodyText style={styles.todayDescription}>
                {primaryAssigned?.descripcion ??
                  'Cuéntanos cómo te has sentido en las últimas 24 horas para mantener tu registro al día.'}
              </BodyText>

              {dailyStatus?.hasSubmittedToday ? (
                <View style={styles.actionContainer}>
                  <VisualButton
                    label="Ver mi registro de hoy"
                    onPress={() => {
                      if (dailyStatus.lastSubmission) {
                        router.push({
                          pathname: '/formulario/entrega',
                          params: { id: dailyStatus.lastSubmission.id },
                        });
                      }
                    }}
                  />
                  <VisualButton
                    label="Registrar una nueva actualización"
                    secondary
                    onPress={handleStartOrContinue}
                  />
                </View>
              ) : dailyStatus?.hasActiveDraft ? (
                <View style={styles.actionContainer}>
                  <VisualButton
                    label="Continuar mi registro de hoy"
                    onPress={handleStartOrContinue}
                  />
                </View>
              ) : (
                <View style={styles.actionContainer}>
                  <VisualButton
                    label="Responder seguimiento de hoy"
                    onPress={handleStartOrContinue}
                  />
                </View>
              )}
            </View>
          </InfoCard>
        </>
      )}

      <SectionTitle>Historial y consultas</SectionTitle>
      <NavigationCard
        title="Historial de evaluaciones"
        description="Revisa tus respuestas anteriores y comprobantes de registro."
        icon="calendar"
        href="/formulario/historial"
      />
    </Screen>
  );
}

function createStyles(colors: {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  text: string;
  border: string;
  warning: string;
}) {
  return StyleSheet.create({
    todayCard: {
      gap: 12,
    },
    todayHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
      flexWrap: 'wrap',
    },
    todayTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    todayTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      flexShrink: 1,
    },
    todayDescription: {
      fontSize: 14,
      color: colors.secondary,
      lineHeight: 20,
    },
    actionContainer: {
      gap: 10,
      marginTop: 6,
    },
    olderDraftCard: {
      gap: 12,
    },
    olderDraftHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    olderDraftTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    olderDraftActions: {
      gap: 8,
      marginTop: 4,
    },
    incompatibleContainer: {
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
    },
    incompatibleTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
  });
}
