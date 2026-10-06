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
  DetailRow,
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
import { medicalFormsService } from './medical-form-service';
import { validateFormAnswers } from './medical-form-validation';
import type { FormAnswerValue, MedicalFormDraft, MedicalFormQuestion } from './medical-form-types';

export function MedicalFormsHubScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { patientId } = useLocalData();

  const assignedForms = medicalFormsService.getAssignedForms(patientId ?? '');

  const loadDrafts = useCallback(async () => {
    if (!patientId) return [];
    return listPatientDrafts(patientId);
  }, [patientId]);

  const { value: drafts, loading } = useFocusedValue(loadDrafts, [] as MedicalFormDraft[]);

  // Agrupación estricta por formularioId y version
  const draftMap = new Map(drafts.map((d) => [`${d.formularioId}:${d.version}`, d]));

  return (
    <Screen title="Cuestionarios médicos">
      <DemoBadge />
      <BodyText>
        Muestras de evaluaciones estructuradas para el seguimiento continuo de tu bienestar.
      </BodyText>

      <NavigationCard
        title="Registro de síntomas de hoy"
        description="Describe libremente sensaciones o molestias para tu historial local."
        icon="edit-3"
        href="/formulario/sintomas-libres"
      />

      <SectionTitle>Cuestionarios asignados</SectionTitle>

      {assignedForms.map((form) => {
        const draftKey = `${form.id}:${form.version}`;
        const draft = draftMap.get(draftKey);
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

  const form = patientId ? medicalFormsService.getForm(patientId, id ?? '') : null;

  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [completed, setCompleted] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isReviewing, setIsReviewing] = useState(false);
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
          description="No se encontró la evaluación asignada para este paciente."
        />
      </Screen>
    );
  }

  function handleSingleChoice(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setValidationErrors((prev) => {
      const copy = { ...prev };
      delete copy[questionId];
      return copy;
    });
    setFeedback(null);
  }

  function handleMultipleChoice(questionId: string, value: string) {
    setAnswers((prev) => {
      const current = (prev[questionId] as string[]) || [];
      let updated: string[];
      if (value === 'ninguna') {
        // Regla excluyente: si se marca 'ninguna', desmarca todas las demás
        updated = current.includes('ninguna') ? [] : ['ninguna'];
      } else {
        // Si se marca cualquier otra opción, desmarca 'ninguna'
        const withoutNinguna = current.filter((v) => v !== 'ninguna');
        updated = withoutNinguna.includes(value)
          ? withoutNinguna.filter((v) => v !== value)
          : [...withoutNinguna, value];
      }
      return { ...prev, [questionId]: updated };
    });
    setValidationErrors((prev) => {
      const copy = { ...prev };
      delete copy[questionId];
      return copy;
    });
    setFeedback(null);
  }

  function handleScale(questionId: string, value: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setValidationErrors((prev) => {
      const copy = { ...prev };
      delete copy[questionId];
      return copy;
    });
    setFeedback(null);
  }

  function handleText(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setValidationErrors((prev) => {
      const copy = { ...prev };
      delete copy[questionId];
      return copy;
    });
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

  function handleReviewAndValidate() {
    if (!form) return;
    setFeedback(null);
    const validation = validateFormAnswers(form, answers);
    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      setFeedback('Faltan respuestas obligatorias o hay valores no válidos.');
      return;
    }
    setValidationErrors({});
    setIsReviewing(true);
  }

  async function handleConfirmComplete() {
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
      setIsReviewing(false);
      setFeedback(
        'Cuestionario completado y guardado en almacenamiento local del dispositivo (sin envío a servidor).',
      );
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
      setIsReviewing(false);
      setValidationErrors({});
      setFeedback('Borrador descartado del dispositivo.');
    } catch {
      setFeedback('No se pudo descartar el borrador.');
    } finally {
      setBusy(false);
    }
  }

  // Vista de Revisión Previa
  if (isReviewing) {
    return (
      <Screen title={`Revisión: ${form.titulo}`} backTo="/formulario">
        <DemoBadge />
        <InfoCard>
          <SectionTitle>Revisión de respuestas</SectionTitle>
          <BodyText>
            Verifica tus respuestas antes de confirmar. Quedarán almacenadas localmente en el
            dispositivo.
          </BodyText>
        </InfoCard>

        {form.preguntas.map((q, idx) => {
          const val = answers[q.id];
          let displayVal = 'Sin respuesta (opcional)';
          if (val !== undefined && val !== null && val !== '') {
            if (Array.isArray(val)) {
              displayVal = val.length ? val.join(', ') : 'Ninguna seleccionada';
            } else {
              displayVal = String(val);
            }
          }
          return (
            <InfoCard key={q.id}>
              <Text style={styles.questionNumber}>
                Pregunta {idx + 1} de {form.preguntas.length}
              </Text>
              <Text style={styles.questionTitle}>{q.pregunta}</Text>
              <DetailRow label="Respuesta" value={displayVal} />
            </InfoCard>
          );
        })}

        <View style={styles.actions}>
          <VisualButton
            label="Confirmar y guardar localmente"
            disabled={busy}
            onPress={handleConfirmComplete}
          />
          <VisualButton
            label="Modificar respuestas"
            secondary
            disabled={busy}
            onPress={() => setIsReviewing(false)}
          />
        </View>
      </Screen>
    );
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
            dispositivo (sin envío a servidor).
          </BodyText>
        </InfoCard>
      ) : null}

      {feedback ? (
        <InfoCard>
          <StatusPill>{feedback}</StatusPill>
        </InfoCard>
      ) : null}

      {form.preguntas.map((question, index) => {
        const error = validationErrors[question.id];
        return (
          <InfoCard key={question.id}>
            <Text style={styles.questionNumber}>
              Pregunta {index + 1} de {form.preguntas.length}{' '}
              {question.requerida ? '(Obligatoria)' : '(Opcional)'}
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

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </InfoCard>
        );
      })}

      <View style={styles.actions}>
        <VisualButton
          label={completed ? 'Revisar o actualizar respuestas' : 'Revisar y completar'}
          disabled={busy}
          onPress={handleReviewAndValidate}
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
    errorText: {
      fontSize: 13,
      color: colors.error,
      marginTop: theme.spacing.xs,
      fontWeight: '500',
    },
  });
}
