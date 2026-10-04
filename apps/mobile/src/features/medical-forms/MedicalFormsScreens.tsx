import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  ChoiceChip,
  DemoBadge,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../data/local/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import {
  deleteFormDraft,
  listPatientDrafts,
  loadFormDraft,
  saveFormDraft,
} from './form-draft-storage';
import type { FormAnswerValue, MedicalFormDraft, MedicalFormQuestion } from './medical-form-types';
import { SAMPLE_MEDICAL_FORMS } from './sample-medical-forms';

export function MedicalFormsHubScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { patientId } = useLocalData();

  const loadDrafts = useCallback(async () => {
    if (!patientId) return [];
    return listPatientDrafts(patientId);
  }, [patientId]);

  const { value: drafts, loading } = useFocusedValue(loadDrafts, [] as MedicalFormDraft[]);

  const draftMap = new Map(drafts.map((d) => [d.formularioId, d]));

  return (
    <Screen title="Cuestionarios médicos">
      <DemoBadge />
      <BodyText>
        Evaluaciones clínicas estructuradas para el seguimiento continuo de tu bienestar.
      </BodyText>

      <NavigationCard
        title="Registro de síntomas de hoy"
        description="Describe libremente sensaciones o molestias para tu historial local."
        icon="edit-3"
        href="/formulario/sintomas-libres"
      />

      <SectionTitle>Cuestionarios asignados</SectionTitle>

      {SAMPLE_MEDICAL_FORMS.map((form) => {
        const draft = draftMap.get(form.id);
        const isCompleted = draft?.completado === true;
        const hasDraft = Boolean(draft && !draft.completado);

        return (
          <InfoCard key={form.id}>
            <View style={styles.cardHeader}>
              <Feather name="clipboard" size={24} color={appTheme.colors.primary} />
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>{form.titulo}</Text>
                <BodyText>
                  Versión {form.version} · {form.duracionEstimadaMin} min aprox.
                </BodyText>
              </View>
            </View>

            <BodyText>{form.descripcion}</BodyText>

            <View style={styles.pillRow}>
              <StatusPill>
                {loading
                  ? 'Comprobando…'
                  : isCompleted
                    ? 'Completado en dispositivo'
                    : hasDraft
                      ? `Borrador guardado (${formatDate(draft!.guardadoEn)})`
                      : 'Pendiente de responder'}
              </StatusPill>
            </View>

            <VisualButton
              label={
                isCompleted
                  ? 'Ver respuestas registradas'
                  : hasDraft
                    ? 'Continuar borrador'
                    : 'Responder cuestionario'
              }
              secondary={isCompleted}
              onPress={() =>
                router.navigate('/formulario/cuestionario?id=' + encodeURIComponent(form.id))
              }
            />
          </InfoCard>
        );
      })}

      <InfoCard>
        <SectionTitle>Aviso sobre datos locales</SectionTitle>
        <BodyText>
          Los cuestionarios y sus borradores se guardan provisionalmente en el almacenamiento
          privado de este dispositivo. No se envían a ningún servidor hasta que se defina el
          contrato clínico definitivo.
        </BodyText>
      </InfoCard>
    </Screen>
  );
}

export function MedicalFormDetailScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { patientId } = useLocalData();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const form = SAMPLE_MEDICAL_FORMS.find((f) => f.id === id);

  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [completed, setCompleted] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!patientId || !form) return;
    let mounted = true;
    loadFormDraft(patientId, form.id, form.version).then((draft) => {
      if (!mounted || !draft) return;
      setAnswers(draft.respuestas ?? {});
      setCompleted(draft.completado ?? false);
    });
    return () => {
      mounted = false;
    };
  }, [patientId, form]);

  if (!form) {
    return (
      <Screen title="Cuestionario no encontrado" backTo="/formulario">
        <DemoBadge />
        <EmptyState
          icon="alert-circle"
          title="Cuestionario no disponible"
          description="No se encontró la evaluación solicitada."
        />
      </Screen>
    );
  }

  function handleSingleChoice(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setFeedback(null);
  }

  function handleMultipleChoice(questionId: string, value: string) {
    setAnswers((prev) => {
      const current = (prev[questionId] as string[]) || [];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [questionId]: updated };
    });
    setFeedback(null);
  }

  function handleScale(questionId: string, value: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setFeedback(null);
  }

  function handleText(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setFeedback(null);
  }

  async function handleSaveDraft() {
    if (!patientId || !form || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const draft: MedicalFormDraft = {
        formularioId: form.id,
        version: form.version,
        pacienteId: patientId,
        respuestas: answers,
        completado: false,
        guardadoEn: new Date().toISOString(),
      };
      await saveFormDraft(draft);
      setCompleted(false);
      setFeedback('Borrador guardado localmente en este dispositivo.');
    } catch {
      setFeedback('No se pudo guardar el borrador en el almacenamiento local.');
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    if (!patientId || !form || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const draft: MedicalFormDraft = {
        formularioId: form.id,
        version: form.version,
        pacienteId: patientId,
        respuestas: answers,
        completado: true,
        guardadoEn: new Date().toISOString(),
      };
      await saveFormDraft(draft);
      setCompleted(true);
      setFeedback('Cuestionario guardado como completado en este dispositivo.');
    } catch {
      setFeedback('No se pudo completar el cuestionario.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    if (!patientId || !form || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await deleteFormDraft(patientId, form.id, form.version);
      setAnswers({});
      setCompleted(false);
      setFeedback('Borrador descartado del dispositivo.');
    } catch {
      setFeedback('No se pudo descartar el borrador.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={form.titulo} backTo="/formulario">
      <DemoBadge />
      <BodyText>{form.descripcion}</BodyText>

      {completed ? (
        <InfoCard>
          <StatusPill>Cuestionario completado localmente</StatusPill>
          <BodyText>
            Las respuestas registradas se conservan en el almacenamiento local privado de este
            dispositivo.
          </BodyText>
        </InfoCard>
      ) : null}

      {feedback ? (
        <InfoCard>
          <StatusPill>{feedback}</StatusPill>
        </InfoCard>
      ) : null}

      {form.preguntas.map((question, index) => (
        <InfoCard key={question.id}>
          <Text style={styles.questionNumber}>
            Pregunta {index + 1} de {form.preguntas.length}
          </Text>
          <Text style={styles.questionTitle}>{question.pregunta}</Text>
          {question.descripcion ? <BodyText>{question.descripcion}</BodyText> : null}

          {renderQuestionInput(question, answers, {
            onSingle: handleSingleChoice,
            onMultiple: handleMultipleChoice,
            onScale: handleScale,
            onText: handleText,
            styles,
            colors: appTheme.colors,
          })}
        </InfoCard>
      ))}

      <View style={styles.actions}>
        <VisualButton
          label={completed ? 'Actualizar respuestas' : 'Completar cuestionario'}
          disabled={busy}
          onPress={handleComplete}
        />
        {!completed ? (
          <VisualButton
            label="Guardar borrador local"
            secondary
            disabled={busy}
            onPress={handleSaveDraft}
          />
        ) : null}
        <VisualButton
          label="Descartar respuestas"
          secondary
          disabled={busy}
          onPress={handleDiscard}
        />
      </View>
    </Screen>
  );
}

function renderQuestionInput(
  question: MedicalFormQuestion,
  answers: Record<string, FormAnswerValue>,
  helpers: {
    onSingle: (qId: string, val: string) => void;
    onMultiple: (qId: string, val: string) => void;
    onScale: (qId: string, val: number) => void;
    onText: (qId: string, val: string) => void;
    styles: ReturnType<typeof createStyles>;
    colors: ReturnType<typeof useAppTheme>['theme']['colors'];
  },
) {
  const currentVal = answers[question.id];

  if (question.tipo === 'single_choice' && question.opciones) {
    return (
      <View style={helpers.styles.chips}>
        {question.opciones.map((opt) => (
          <ChoiceChip
            key={opt.valor}
            label={opt.etiqueta}
            selected={currentVal === opt.valor}
            onPress={() => helpers.onSingle(question.id, opt.valor)}
          />
        ))}
      </View>
    );
  }

  if (question.tipo === 'multiple_choice' && question.opciones) {
    const selectedList = (currentVal as string[]) || [];
    return (
      <View style={helpers.styles.chips}>
        {question.opciones.map((opt) => (
          <ChoiceChip
            key={opt.valor}
            label={opt.etiqueta}
            selected={selectedList.includes(opt.valor)}
            onPress={() => helpers.onMultiple(question.id, opt.valor)}
          />
        ))}
      </View>
    );
  }

  if (question.tipo === 'scale_0_10') {
    return (
      <View style={helpers.styles.scaleContainer}>
        {question.minEtiqueta || question.maxEtiqueta ? (
          <View style={helpers.styles.scaleLabels}>
            <Text style={helpers.styles.scaleSub}>{question.minEtiqueta ?? '0'}</Text>
            <Text style={helpers.styles.scaleSub}>{question.maxEtiqueta ?? '10'}</Text>
          </View>
        ) : null}
        <View style={helpers.styles.scaleChips}>
          {Array.from({ length: 11 }, (_, i) => i).map((num) => (
            <ChoiceChip
              key={num}
              label={String(num)}
              selected={currentVal === num}
              onPress={() => helpers.onScale(question.id, num)}
            />
          ))}
        </View>
      </View>
    );
  }

  if (question.tipo === 'text') {
    return (
      <TextInput
        style={helpers.styles.textInput}
        multiline
        numberOfLines={3}
        placeholder="Escribe tus observaciones aquí…"
        placeholderTextColor={helpers.colors.secondary}
        value={typeof currentVal === 'string' ? currentVal : ''}
        onChangeText={(text) => helpers.onText(question.id, text)}
      />
    );
  }

  return null;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.xs,
    },
    cardHeaderCopy: { flex: 1, gap: 2 },
    cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
    pillRow: { marginVertical: theme.spacing.xs },
    questionNumber: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    questionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      marginVertical: theme.spacing.xs,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    scaleContainer: {
      gap: theme.spacing.xs,
      marginTop: theme.spacing.xs,
    },
    scaleLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    scaleSub: {
      fontSize: 12,
      color: colors.secondary,
    },
    scaleChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    textInput: {
      minHeight: 80,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.sm,
      color: colors.text,
      fontSize: 14,
      textAlignVertical: 'top',
      marginTop: theme.spacing.sm,
    },
    actions: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
  });
}
