import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  findNodeHandle,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Screen } from '../../components/Screen';
import { BodyText, FeedbackBanner, ProgressBar, VisualButton } from '../../components/Visual';
import type { FormAnswerValue, QuestionConfiguration } from '../../data/local/forms/form-types';
import {
  type FullFormDefinition,
  selectDailyFormAssignment,
} from '../../data/local/forms/form-repository';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { computeVisibleQuestions } from '../../services/forms/form-conditions';
import { FormDraftController } from './form-draft-controller';
import { QuestionInput } from './components/QuestionInput';

export function FormSectionScreen() {
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
  }>();

  const [loading, setLoading] = useState(true);
  const [formDef, setFormDef] = useState<FullFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [currentSectionId, setCurrentSectionId] = useState<string>('');
  const [deliveryId, setDeliveryId] = useState<string>('');
  const [activePeriod, setActivePeriod] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [autosaveError, setAutosaveError] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const headerRef = useRef<View>(null);
  const questionRefs = useRef<Map<string, View>>(new Map());
  const controllerRef = useRef<FormDraftController | null>(null);

  // Carga inicial de definición y borrador
  useEffect(() => {
    let isMounted = true;

    async function init() {
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

        const draftData = await runTracked(async () => {
          return repository.getOrCreateDailyDraft(
            definition.formulario_id,
            definition.version,
            params.periodoClave,
          );
        });

        if (!isMounted) return;

        setFormDef(definition);
        setAnswers(draftData.respuestas ?? {});
        setDeliveryId(draftData.entregaId);
        setActivePeriod(draftData.periodoClave);

        // Inicializar sección desde paso_actual persistido o primera sección
        const secciones = definition.configuracion?.secciones;
        if (Array.isArray(secciones) && secciones.length > 0) {
          const matched = secciones.find((s) => s.id === draftData.pasoActual);
          setCurrentSectionId(matched ? matched.id : secciones[0].id);
        } else {
          setCurrentSectionId('general');
        }

        // Crear controlador de guardado persistente
        controllerRef.current = new FormDraftController({
          identity: {
            formId: definition.formulario_id,
            version: definition.version,
            periodoClave: draftData.periodoClave,
            deliveryId: draftData.entregaId,
          },
          onSave: async (identity, saveAnswers, currentSection) => {
            await runTracked(async () => {
              await repository.saveDailyDraft(identity, saveAnswers, currentSection);
            });
          },
          onConfirm: async (identity, confirmAnswers) => {
            return runTracked(async () => {
              return repository.confirmDailySubmission(identity, confirmAnswers);
            });
          },
          onSaveSuccess: () => {
            if (isMounted) setAutosaveError(false);
          },
          onSaveError: () => {
            if (isMounted) setAutosaveError(true);
          },
          debounceMs: 400,
        });

        setLoading(false);
      } catch (error) {
        if (!isMounted) return;
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'No se pudo cargar el cuestionario.',
        );
        router.replace('/formulario');
      }
    }

    void init();

    return () => {
      isMounted = false;
      controllerRef.current?.dispose();
    };
  }, [repository, patientId, formStorageReady, params.id, params.version, params.periodoClave]);

  // Secciones dinámicas
  const sections = useMemo<
    Array<{ id: string; titulo: string; descripcion?: string | null }>
  >(() => {
    if (!formDef) return [];
    if (formDef.configuracion?.secciones && formDef.configuracion.secciones.length > 0) {
      return formDef.configuracion.secciones;
    }
    return [
      {
        id: 'general',
        titulo: formDef.titulo,
        descripcion: formDef.descripcion,
      },
    ];
  }, [formDef]);

  const currentSectionIndex = useMemo(() => {
    const idx = sections.findIndex((s) => s.id === currentSectionId);
    return idx >= 0 ? idx : 0;
  }, [sections, currentSectionId]);

  const currentSection = sections[currentSectionIndex] ?? {
    id: 'general',
    titulo: formDef?.titulo ?? '',
    descripcion: formDef?.descripcion ?? '',
  };

  // Preguntas de la sección actual
  const sectionQuestions = useMemo(() => {
    if (!formDef) return [];
    const hasMultipleSections = sections.length > 1;
    return formDef.preguntas.filter((q) => {
      if (!hasMultipleSections) return true;
      return q.configuracion?.sectionId === currentSection.id;
    });
  }, [formDef, sections, currentSection.id]);

  // Cálculo de preguntas visibles (resuelve dependencias encadenadas)
  const visibleQuestionIds = useMemo(() => {
    if (!formDef) return new Set<string>();
    return computeVisibleQuestions(
      formDef.preguntas.map((q) => ({
        preguntaId: q.pregunta_id,
        configuracion: q.configuracion as QuestionConfiguration,
      })),
      answers,
    );
  }, [formDef, answers]);

  const visibleSectionQuestions = useMemo(() => {
    return sectionQuestions.filter((q) => visibleQuestionIds.has(q.pregunta_id));
  }, [sectionQuestions, visibleQuestionIds]);

  // Manejo de cambio de respuesta con confirmación contextual ante ocultamiento de hijas respondidas
  const handleAnswerChange = useCallback(
    (questionId: string, newValue: FormAnswerValue) => {
      if (!formDef) return;

      const nextAnswers = { ...answers, [questionId]: newValue };

      // Calcular qué preguntas quedarían visibles con el nuevo valor
      const nextVisibleIds = computeVisibleQuestions(
        formDef.preguntas.map((q) => ({
          preguntaId: q.pregunta_id,
          configuracion: q.configuracion as QuestionConfiguration,
        })),
        nextAnswers,
      );

      // Comprobar si alguna pregunta que estaba visible y respondida quedaría oculta
      const wouldHideAnsweredChildren = Object.keys(answers).some((key) => {
        if (key === questionId) return false;
        const wasVisible = visibleQuestionIds.has(key);
        const willBeVisible = nextVisibleIds.has(key);
        const hadAnswer =
          answers[key] !== undefined && answers[key] !== '' && answers[key] !== null;
        return wasVisible && !willBeVisible && hadAnswer;
      });

      if (wouldHideAnsweredChildren) {
        Alert.alert(
          'Cambiar respuesta',
          'Al cambiar esta respuesta se quitarán las respuestas de las preguntas asociadas que ya habías contestado.',
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Cambiar y quitar',
              style: 'destructive',
              onPress: () => {
                // Podar respuestas que quedaron ocultas
                const prunedAnswers = { ...nextAnswers };
                for (const key of Object.keys(prunedAnswers)) {
                  if (!nextVisibleIds.has(key) && key !== questionId) {
                    delete prunedAnswers[key];
                  }
                }
                setAnswers(prunedAnswers);
                setValidationErrors((prev) => {
                  const updated = { ...prev };
                  delete updated[questionId];
                  return updated;
                });
                controllerRef.current?.queueSave(prunedAnswers, currentSection.id);
              },
            },
          ],
        );
        return;
      }

      // Cambio directo sin hijas afectadas
      setAnswers(nextAnswers);
      setValidationErrors((prev) => {
        const updated = { ...prev };
        delete updated[questionId];
        return updated;
      });
      controllerRef.current?.queueSave(nextAnswers, currentSection.id);
    },
    [formDef, answers, visibleQuestionIds, currentSection.id],
  );

  // Validación de la sección actual antes de avanzar
  const validateCurrentSection = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    for (const q of visibleSectionQuestions) {
      if (q.requerida === 1) {
        const ans = answers[q.pregunta_id];
        if (ans === undefined || ans === null || ans === '') {
          errors[q.pregunta_id] = 'Esta pregunta es obligatoria.';
        } else if (Array.isArray(ans) && ans.length === 0) {
          errors[q.pregunta_id] = 'Selecciona al menos una opción.';
        }
      }
    }

    setValidationErrors(errors);

    const firstErrorId = Object.keys(errors)[0];
    if (firstErrorId) {
      setTimeout(() => {
        const targetNode = questionRefs.current.get(firstErrorId);
        if (targetNode) {
          const reactTag = findNodeHandle(targetNode);
          if (reactTag) {
            AccessibilityInfo.setAccessibilityFocus(reactTag);
          }
        }
      }, 50);
      AccessibilityInfo.announceForAccessibility(
        `Hay preguntas obligatorias sin responder en esta sección: ${errors[firstErrorId]}`,
      );
    }

    return Object.keys(errors).length === 0;
  }, [visibleSectionQuestions, answers]);

  const handleNextSection = useCallback(() => {
    if (!validateCurrentSection()) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    const nextIndex = currentSectionIndex + 1;
    if (nextIndex < sections.length) {
      const nextSection = sections[nextIndex];
      setCurrentSectionId(nextSection.id);
      controllerRef.current?.queueSave(answers, nextSection.id, true);

      scrollRef.current?.scrollTo({ y: 0, animated: false });
      AccessibilityInfo.announceForAccessibility(
        `Sección ${nextIndex + 1} de ${sections.length}: ${nextSection.titulo}`,
      );
      setTimeout(() => {
        if (headerRef.current) {
          const reactTag = findNodeHandle(headerRef.current);
          if (reactTag) {
            AccessibilityInfo.setAccessibilityFocus(reactTag);
          }
        }
      }, 50);
    } else {
      // Última sección: ir al resumen de revisión
      void (async () => {
        try {
          await controllerRef.current?.flush();
          router.push({
            pathname: '/formulario/resumen',
            params: {
              id: formDef?.formulario_id,
              version: formDef?.version,
              periodoClave: activePeriod,
              deliveryId,
            },
          });
        } catch {
          setAutosaveError(true);
          Alert.alert(
            'Error al guardar',
            'No se pudieron guardar las respuestas. Por favor, reintenta antes de continuar a la revisión.',
          );
        }
      })();
    }
  }, [
    validateCurrentSection,
    currentSectionIndex,
    sections,
    answers,
    formDef,
    activePeriod,
    deliveryId,
  ]);

  const handlePrevSection = useCallback(() => {
    if (currentSectionIndex > 0) {
      const prevSection = sections[currentSectionIndex - 1];
      setCurrentSectionId(prevSection.id);
      controllerRef.current?.queueSave(answers, prevSection.id, true);

      scrollRef.current?.scrollTo({ y: 0, animated: false });
      AccessibilityInfo.announceForAccessibility(
        `Sección ${currentSectionIndex} de ${sections.length}: ${prevSection.titulo}`,
      );
      setTimeout(() => {
        if (headerRef.current) {
          const reactTag = findNodeHandle(headerRef.current);
          if (reactTag) {
            AccessibilityInfo.setAccessibilityFocus(reactTag);
          }
        }
      }, 50);
    }
  }, [currentSectionIndex, sections, answers]);

  const handleSaveAndExit = useCallback(async () => {
    try {
      await controllerRef.current?.flush();
      router.replace('/formulario');
    } catch {
      setAutosaveError(true);
      Alert.alert(
        'Error al guardar',
        'No se pudieron guardar los cambios en el borrador. Revisa tu conexión o vuelve a intentar antes de salir.',
      );
    }
  }, []);

  const handleRetrySave = useCallback(() => {
    setAutosaveError(false);
    controllerRef.current?.queueSave(answers, currentSection.id, true);
  }, [answers, currentSection.id]);

  if (loading || !formDef) {
    return (
      <Screen isRoot={false} title="Cargando...">
        <BodyText>Cargando cuestionario...</BodyText>
      </Screen>
    );
  }

  const progressPercent = Math.round(((currentSectionIndex + 1) / sections.length) * 100);

  return (
    <Screen isRoot={false} scroll={false}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {autosaveError && (
          <View style={{ marginBottom: 16 }}>
            <FeedbackBanner
              variant="error"
              title="No se pudo guardar automáticamente el borrador"
              message="Tus respuestas siguen intactas en la pantalla. Puedes reintentar guardar el avance en cualquier momento."
              actionLabel="Reintentar guardado"
              onAction={handleRetrySave}
            />
          </View>
        )}

        {/* Encabezado dinámico de sección */}
        <View
          ref={headerRef}
          collapsable={false}
          accessibilityRole="header"
          style={styles.sectionHeaderCard}
        >
          <Text style={styles.stepperIndicator}>
            Sección {currentSectionIndex + 1} de {sections.length}
          </Text>
          <Text style={styles.sectionTitle}>{currentSection.titulo}</Text>
          {currentSection.descripcion ? (
            <Text style={styles.sectionDescription}>{currentSection.descripcion}</Text>
          ) : null}
          <ProgressBar progress={progressPercent} />
        </View>

        {/* Listado de preguntas de la sección */}
        {visibleSectionQuestions.length === 0 ? (
          <View style={styles.emptyQuestionsBox}>
            <BodyText>No hay preguntas aplicables en esta sección según tus respuestas.</BodyText>
          </View>
        ) : (
          visibleSectionQuestions.map((q) => (
            <View
              key={q.pregunta_id}
              ref={(node) => {
                if (node) {
                  questionRefs.current.set(q.pregunta_id, node);
                } else {
                  questionRefs.current.delete(q.pregunta_id);
                }
              }}
              collapsable={false}
            >
              <QuestionInput
                question={{
                  id: q.pregunta_id,
                  pregunta: q.texto,
                  descripcion: q.descripcion,
                  tipo: q.tipo,
                  requerida: q.requerida === 1,
                  configuracion: q.configuracion as QuestionConfiguration,
                }}
                value={answers[q.pregunta_id]}
                onChange={(val) => handleAnswerChange(q.pregunta_id, val)}
                error={validationErrors[q.pregunta_id]}
              />
            </View>
          ))
        )}

        {/* Controles de navegación */}
        <View style={styles.navButtonsContainer}>
          <VisualButton
            label={currentSectionIndex === sections.length - 1 ? 'Revisar respuestas' : 'Continuar'}
            onPress={handleNextSection}
          />
          {currentSectionIndex > 0 ? (
            <VisualButton label="Anterior" secondary onPress={handlePrevSection} />
          ) : null}
          <VisualButton label="Pausar y seguir más tarde" secondary onPress={handleSaveAndExit} />
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
}) {
  return StyleSheet.create({
    scrollContent: {
      paddingBottom: 40,
    },
    sectionHeaderCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    stepperIndicator: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
      lineHeight: 26,
    },
    sectionDescription: {
      fontSize: 14,
      color: colors.secondary,
      lineHeight: 20,
    },
    emptyQuestionsBox: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 20,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    navButtonsContainer: {
      gap: 12,
      marginTop: 10,
    },
  });
}
