import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  DetailRow,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import type { FormAnswerValue, QuestionConfiguration } from '../../data/local/forms/form-types';
import {
  type FullFormDefinition,
  selectDailyFormAssignment,
} from '../../data/local/forms/form-repository';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { computeVisibleQuestions } from '../../services/forms/form-conditions';

export function DailyFormReviewScreen() {
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

  const params = useLocalSearchParams<{
    id?: string;
    version?: string;
    periodoClave?: string;
    deliveryId?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [formDef, setFormDef] = useState<FullFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmedDeliveryId, setConfirmedDeliveryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!repository || !patientId || !formStorageReady) return;

      try {
        let formId = params.id;
        let version = params.version;

        if (!formId) {
          const assigned = await repository.listAssignedForms();
          const target = selectDailyFormAssignment(assigned);
          if (!target) {
            router.replace('/formulario');
            return;
          }
          formId = target.formulario_id;
          version = target.version;
        }

        const definition = await repository.getFormDefinition(formId, version);
        if (!definition) {
          Alert.alert('Error', 'No se encontró la definición del cuestionario.');
          router.replace('/formulario');
          return;
        }

        const draft = await repository.getDraft(
          definition.formulario_id,
          definition.version,
          params.periodoClave ?? 'legacy',
        );

        if (!mounted) return;

        setFormDef(definition);
        setAnswers(draft?.respuestas ?? {});
        setLoading(false);
      } catch (error) {
        if (!mounted) return;
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'No se pudo cargar el resumen.',
        );
        router.replace('/formulario');
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [repository, patientId, formStorageReady, params.id, params.version, params.periodoClave]);

  // Preguntas visibles según respuestas dadas
  const visibleQuestions = useMemo(() => {
    if (!formDef) return [];
    const visibleIds = computeVisibleQuestions(
      formDef.preguntas.map((q) => ({
        preguntaId: q.pregunta_id,
        configuracion: q.configuracion as QuestionConfiguration,
      })),
      answers,
    );
    return formDef.preguntas.filter((q) => visibleIds.has(q.pregunta_id));
  }, [formDef, answers]);

  const handleConfirm = async () => {
    if (!formDef || !repository) return;
    setBusy(true);
    setErrorMessage(null);

    const deliveryIdToUse =
      params.deliveryId ||
      (await repository.getDraft(formDef.formulario_id, formDef.version, params.periodoClave))
        ?.entregaId;

    if (!deliveryIdToUse) {
      setErrorMessage('No se encontró el identificador del borrador.');
      setBusy(false);
      return;
    }

    try {
      const confirmedId = await runTracked(async () => {
        return repository.confirmDailySubmission(
          {
            formId: formDef.formulario_id,
            version: formDef.version,
            periodoClave: params.periodoClave ?? 'legacy',
            deliveryId: deliveryIdToUse,
          },
          answers,
        );
      });

      setIsConfirmed(true);
      setConfirmedDeliveryId(confirmedId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo confirmar la entrega.');
    } finally {
      setBusy(false);
    }
  };

  const handleModify = () => {
    router.back();
  };

  if (loading || !formDef) {
    return (
      <Screen isRoot={false} title="Cargando resumen...">
        <BodyText>Cargando respuestas para revisión...</BodyText>
      </Screen>
    );
  }

  return (
    <Screen
      isRoot={false}
      title={isConfirmed ? 'Seguimiento registrado' : `Revisión: ${formDef.titulo}`}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <DemoBadge />

        <InfoCard>
          <StatusPill>
            {isConfirmed
              ? 'Guardado en este dispositivo · Pendiente de envío'
              : 'Verificación antes de entregar'}
          </StatusPill>
          <SectionTitle>
            {isConfirmed ? 'Registro completado con éxito' : 'Revisa tus respuestas'}
          </SectionTitle>
          <BodyText>
            {isConfirmed
              ? 'Tu seguimiento ha quedado guardado localmente de forma segura y encolado para sincronización cuando haya conexión disponible.'
              : 'Verifica que tus respuestas reflejen cómo te has sentido en las últimas 24 horas antes de confirmar la entrega en este dispositivo.'}
          </BodyText>
          <BodyText style={styles.disclaimerText}>
            Modo demostración: los datos se conservan localmente en este dispositivo y no generan
            alertas médicas automáticas a tu equipo de salud.
          </BodyText>
        </InfoCard>

        {errorMessage ? (
          <InfoCard>
            <View style={styles.errorHeader}>
              <Feather
                name="alert-circle"
                size={20}
                color={appTheme.colors.error}
                accessible={false}
              />
              <Text style={styles.errorTitle}>Error al confirmar</Text>
            </View>
            <BodyText>{errorMessage}</BodyText>
          </InfoCard>
        ) : null}

        <SectionTitle>Respuestas del cuestionario</SectionTitle>

        {visibleQuestions.length === 0 ? (
          <InfoCard>
            <BodyText>No hay respuestas registradas para revisar.</BodyText>
          </InfoCard>
        ) : (
          visibleQuestions.map((q, idx) => {
            const val = answers[q.pregunta_id];
            let displayVal = 'Sin respuesta (opcional)';

            if (val !== undefined && val !== null && val !== '') {
              if (Array.isArray(val)) {
                if (val.length === 0) {
                  displayVal = 'Ninguna seleccionada';
                } else {
                  // Mapear a etiquetas legibles si están definidas
                  const opciones = q.configuracion?.opciones;
                  if (Array.isArray(opciones)) {
                    displayVal = val
                      .map((item) => opciones.find((o) => o.valor === item)?.etiqueta ?? item)
                      .join(', ');
                  } else {
                    displayVal = val.join(', ');
                  }
                }
              } else if (typeof val === 'string') {
                const opciones = q.configuracion?.opciones;
                if (Array.isArray(opciones)) {
                  displayVal = opciones.find((o) => o.valor === val)?.etiqueta ?? val;
                } else {
                  displayVal = val;
                }
              } else if (typeof val === 'number') {
                displayVal = String(val);
                if (q.tipo === 'scale_0_10') {
                  displayVal = `${val} / 10`;
                }
              }
            }

            return (
              <InfoCard key={q.pregunta_id}>
                <Text style={styles.questionIndex}>
                  Pregunta {idx + 1} de {visibleQuestions.length}
                </Text>
                <Text style={styles.questionText}>{q.texto}</Text>
                <DetailRow label="Tu respuesta" value={displayVal} />
              </InfoCard>
            );
          })
        )}

        <View style={styles.actions}>
          {!isConfirmed ? (
            <>
              <VisualButton
                label="Confirmar y registrar seguimiento"
                disabled={busy}
                onPress={handleConfirm}
              />
              <VisualButton
                label="Modificar respuestas"
                secondary
                disabled={busy}
                onPress={handleModify}
              />
            </>
          ) : (
            <>
              <VisualButton label="Volver al inicio" onPress={() => router.replace('/')} />
              <VisualButton
                label="Ver en mi historial"
                secondary
                onPress={() => {
                  if (confirmedDeliveryId) {
                    router.replace({
                      pathname: '/formulario/entrega',
                      params: { id: confirmedDeliveryId },
                    });
                  } else {
                    router.replace('/formulario/historial');
                  }
                }}
              />
            </>
          )}
        </View>
      </ScrollView>
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
  error: string;
}) {
  return StyleSheet.create({
    scrollContent: {
      paddingBottom: 40,
    },
    disclaimerText: {
      fontSize: 13,
      color: colors.secondary,
      fontStyle: 'italic',
      marginTop: 6,
    },
    errorHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    errorTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.error,
    },
    questionIndex: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
      marginBottom: 4,
    },
    questionText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
      lineHeight: 22,
    },
    actions: {
      gap: 12,
      marginTop: 16,
    },
  });
}
