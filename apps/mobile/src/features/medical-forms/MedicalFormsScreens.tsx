import Feather from '@expo/vector-icons/Feather';
import * as Crypto from 'expo-crypto';
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
import {
  type AssignedFormSummary,
  type FullFormDefinition,
  type FormSubmissionDetail,
} from '../../data/local/forms/form-repository';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { validateFormAnswers } from './medical-form-validation';
import type {
  FormAnswerValue,
  MedicalFormDefinition,
  MedicalFormQuestion,
} from './medical-form-types';

export function toMedicalFormDefinition(fullDef: FullFormDefinition): MedicalFormDefinition {
  return {
    id: fullDef.formulario_id,
    titulo: fullDef.titulo,
    descripcion: fullDef.descripcion,
    version: fullDef.version,
    duracionEstimadaMin: fullDef.duracion_estimada_min,
    preguntas: fullDef.preguntas.map((q) => ({
      id: q.pregunta_id,
      pregunta: q.texto,
      descripcion: q.descripcion ?? undefined,
      tipo: q.tipo,
      opciones: q.configuracion?.opciones,
      minEtiqueta: q.configuracion?.minEtiqueta,
      maxEtiqueta: q.configuracion?.maxEtiqueta,
      requerida: q.requerida === 1,
    })),
  };
}

export function MedicalFormsHubScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const {
    repository,
    patientId,
    formStorageReady,
    formImportStatus,
    formImportError,
    formImportWarning,
    retryFormImport,
  } = useLocalData();

  const loadAssigned = useCallback(async () => {
    if (!repository || !patientId || !formStorageReady) return [];
    return repository.listAssignedForms();
  }, [repository, patientId, formStorageReady]);

  const { value: assignedForms, loading } = useFocusedValue(
    loadAssigned,
    [] as AssignedFormSummary[],
  );

  return (
    <Screen isRoot title="Cuestionarios médicos">
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

      <NavigationCard
        title="Historial de evaluaciones"
        description="Consulta las respuestas confirmadas en este dispositivo."
        icon="clock"
        href="/formulario/historial"
      />

      <SectionTitle>Cuestionarios asignados</SectionTitle>

      {formImportWarning ? (
        <InfoCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Feather name="alert-triangle" size={20} color={appTheme.colors.warning ?? '#D97706'} />
            <Text style={{ fontWeight: '600', color: appTheme.colors.text }}>
              Atención sobre datos previos
            </Text>
          </View>
          <BodyText>
            {formImportWarning.errors > 0
              ? `Se detectaron ${formImportWarning.errors} archivo(s) anteriores que requieren revisión manual.`
              : `Hay ${formImportWarning.pendingCleanups} archivo(s) pendientes de limpieza en el almacenamiento.`}
          </BodyText>
        </InfoCard>
      ) : null}

      {formImportStatus === 'importing' ? (
        <InfoCard>
          <StatusPill>Preparando cuestionarios…</StatusPill>
          <BodyText>
            Recuperando y sincronizando borradores del paciente en este dispositivo.
          </BodyText>
        </InfoCard>
      ) : null}

      {formImportStatus === 'error' ? (
        <InfoCard>
          <EmptyState
            icon="alert-circle"
            title="Error al preparar almacenamiento"
            description={
              formImportError ?? 'No se pudo sincronizar el almacenamiento local de formularios.'
            }
          />
          <View style={{ marginTop: theme.spacing.sm }}>
            <VisualButton label="Reintentar preparación" onPress={retryFormImport} />
          </View>
        </InfoCard>
      ) : null}

      {assignedForms.map((form) => {
        const hasDraft = Boolean(form.borrador_guardado_en);
        const hasSubmitted = Boolean(form.ultima_fecha_confirmacion);

        return (
          <InfoCard key={`${form.formulario_id}:${form.version}`}>
            <View style={styles.cardHeader}>
              <Feather name="clipboard" size={24} color={appTheme.colors.primary} />
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>{form.titulo}</Text>
                <BodyText>
                  Versión {form.version} · {form.duracion_estimada_min} min aprox.
                </BodyText>
              </View>
            </View>

            <BodyText>{form.descripcion}</BodyText>

            <View style={styles.pillRow}>
              <StatusPill>
                {loading
                  ? 'Comprobando…'
                  : hasDraft
                    ? `Borrador guardado (${formatDate(form.borrador_guardado_en!)})`
                    : hasSubmitted
                      ? 'Completado en dispositivo'
                      : 'Pendiente de responder'}
              </StatusPill>
            </View>

            <View style={styles.cardActions}>
              {hasDraft ? (
                <VisualButton
                  label="Continuar borrador"
                  disabled={!formStorageReady}
                  onPress={() =>
                    router.navigate(
                      `/formulario/cuestionario?id=${encodeURIComponent(form.formulario_id)}&version=${encodeURIComponent(form.version)}`,
                    )
                  }
                />
              ) : hasSubmitted ? (
                <>
                  <VisualButton
                    label="Ver respuestas registradas"
                    disabled={!formStorageReady}
                    onPress={() =>
                      router.navigate(
                        `/formulario/entrega?id=${encodeURIComponent(form.ultima_entrega_id!)}`,
                      )
                    }
                  />
                  <VisualButton
                    label="Responder nuevamente"
                    secondary
                    disabled={!formStorageReady}
                    onPress={() =>
                      router.navigate(
                        `/formulario/cuestionario?id=${encodeURIComponent(form.formulario_id)}&version=${encodeURIComponent(form.version)}`,
                      )
                    }
                  />
                </>
              ) : (
                <VisualButton
                  label="Responder cuestionario"
                  disabled={!formStorageReady}
                  onPress={() =>
                    router.navigate(
                      `/formulario/cuestionario?id=${encodeURIComponent(form.formulario_id)}&version=${encodeURIComponent(form.version)}`,
                    )
                  }
                />
              )}
            </View>
          </InfoCard>
        );
      })}
    </Screen>
  );
}

export function MedicalFormDetailScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const {
    repository,
    patientId,
    formStorageReady,
    formImportStatus,
    formImportError,
    retryFormImport,
    runSave,
  } = useLocalData();
  const { id, version } = useLocalSearchParams<{ id?: string; version?: string }>();

  const [formDef, setFormDef] = useState<FullFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [stableDeliveryId, setStableDeliveryId] = useState<string>(() => Crypto.randomUUID());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isReviewing, setIsReviewing] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Carga atómica de definición y borrador desde SQLite sólo cuando el almacenamiento esté listo
  useEffect(() => {
    if (!repository || !patientId || !id || !formStorageReady) return;
    let mounted = true;
    setLoadingDetail(true);
    setDetailError(null);

    async function load() {
      try {
        const def = await repository!.getFormDefinition(id!, version);
        if (!mounted) return;
        if (!def) {
          setFormDef(null);
          setLoadingDetail(false);
          return;
        }

        const draft = await repository!.getDraft(def.formulario_id, def.version);
        if (!mounted) return;

        // Publicar ambos juntos de manera atómica
        setFormDef(def);
        if (draft) {
          setAnswers(draft.respuestas);
          setStableDeliveryId(draft.entregaId);
        } else {
          setAnswers({});
          setStableDeliveryId(Crypto.randomUUID());
        }
        setLoadingDetail(false);
      } catch (err) {
        if (!mounted) return;
        setDetailError(
          err instanceof Error ? err.message : 'Error al cargar la información del cuestionario.',
        );
        setLoadingDetail(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [repository, patientId, id, version, formStorageReady, loadAttempt]);

  if (!formStorageReady) {
    if (formImportStatus === 'error') {
      return (
        <Screen title="Error de almacenamiento">
          <DemoBadge />
          <InfoCard>
            <EmptyState
              icon="alert-circle"
              title="No se pudo preparar el cuestionario"
              description={formImportError ?? 'Error al procesar el almacenamiento local.'}
            />
            <View style={{ marginTop: theme.spacing.md }}>
              <VisualButton label="Reintentar preparación" onPress={retryFormImport} />
            </View>
          </InfoCard>
        </Screen>
      );
    }
    return (
      <Screen title="Cargando cuestionario…">
        <DemoBadge />
        <InfoCard>
          <StatusPill>Preparando evaluación…</StatusPill>
          <BodyText>Recuperando datos locales y verificando borrador previo…</BodyText>
        </InfoCard>
      </Screen>
    );
  }

  if (loadingDetail) {
    return (
      <Screen title="Cargando cuestionario…">
        <DemoBadge />
        <InfoCard>
          <StatusPill>Recuperando cuestionario…</StatusPill>
          <BodyText>Cargando definición y borrador previo en este dispositivo…</BodyText>
        </InfoCard>
      </Screen>
    );
  }

  if (detailError) {
    return (
      <Screen title="Error de carga">
        <DemoBadge />
        <InfoCard>
          <EmptyState
            icon="alert-circle"
            title="Error al cargar cuestionario"
            description={detailError}
          />
          <View style={{ marginTop: theme.spacing.md }}>
            <VisualButton label="Reintentar carga" onPress={() => setLoadAttempt((a) => a + 1)} />
          </View>
        </InfoCard>
      </Screen>
    );
  }

  if (!formDef) {
    return (
      <Screen title="Cuestionario no encontrado">
        <DemoBadge />
        <EmptyState
          icon="alert-circle"
          title="Cuestionario no disponible"
          description="No se encontró la evaluación asignada para este paciente."
        />
      </Screen>
    );
  }

  const medicalForm = toMedicalFormDefinition(formDef);

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
    const question = formDef?.preguntas.find((p) => p.pregunta_id === questionId);
    const options = question?.configuracion?.opciones ?? [];
    const isOptionExclusive =
      options.find((o) => o.valor === value)?.esExcluyente ?? value === 'ninguna';
    const exclusiveValues = options.filter((o) => o.esExcluyente).map((o) => o.valor);
    if (!exclusiveValues.includes('ninguna') && options.some((o) => o.valor === 'ninguna')) {
      exclusiveValues.push('ninguna');
    }

    setAnswers((prev) => {
      const current = (prev[questionId] as string[]) || [];
      let updated: string[];
      if (isOptionExclusive) {
        updated = current.includes(value) ? [] : [value];
      } else {
        const withoutExclusive = current.filter((v) => !exclusiveValues.includes(v));
        updated = withoutExclusive.includes(value)
          ? withoutExclusive.filter((v) => v !== value)
          : [...withoutExclusive, value];
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
    if (!repository || !patientId || !formDef || busy || !formStorageReady || loadingDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      await runSave(async () => {
        await repository.saveDraft(
          formDef.formulario_id,
          formDef.version,
          answers,
          stableDeliveryId,
        );
      });
      setFeedback('Borrador guardado localmente en este dispositivo.');
    } catch {
      setFeedback('No se pudo guardar el borrador en el almacenamiento local.');
    } finally {
      setBusy(false);
    }
  }

  function handleReview() {
    const validation = validateFormAnswers(medicalForm, answers);
    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      setFeedback('Faltan respuestas obligatorias o hay valores no válidos.');
      return;
    }
    setValidationErrors({});
    setIsReviewing(true);
  }

  async function handleConfirmSubmission() {
    if (!repository || !patientId || !formDef || busy || !formStorageReady || loadingDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      await runSave(async () => {
        await repository.confirmSubmission(
          formDef.formulario_id,
          formDef.version,
          answers,
          stableDeliveryId,
        );
      });
      setIsConfirmed(true);
      setFeedback('Guardado en este dispositivo · Pendiente de envío');
    } catch (err) {
      setFeedback(
        err instanceof Error
          ? err.message
          : 'No se pudo confirmar la entrega en el almacenamiento local.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    if (!repository || !patientId || !formDef || busy || !formStorageReady || loadingDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      await runSave(async () => {
        await repository.discardDraft(formDef.formulario_id, formDef.version);
      });
      setAnswers({});
      setStableDeliveryId(Crypto.randomUUID());
      setIsReviewing(false);
      setIsConfirmed(false);
      setValidationErrors({});
      setFeedback('Borrador descartado del dispositivo.');
    } catch {
      setFeedback('No se pudo descartar el borrador.');
    } finally {
      setBusy(false);
    }
  }

  // Vista de Revisión y Confirmación
  if (isReviewing) {
    return (
      <Screen title={`Revisión: ${formDef.titulo}`}>
        <DemoBadge />
        <InfoCard>
          <StatusPill>
            {isConfirmed
              ? 'Guardado en este dispositivo · Pendiente de envío'
              : 'Respuestas verificadas'}
          </StatusPill>
          <SectionTitle>Respuestas registradas</SectionTitle>
          <BodyText>
            {isConfirmed
              ? 'Tu evaluación ha sido confirmada y encolada localmente para su posterior transmisión.'
              : 'Verifica tus respuestas antes de confirmar la entrega en este dispositivo.'}
          </BodyText>
        </InfoCard>

        {feedback && !isConfirmed ? (
          <InfoCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Feather name="alert-circle" size={20} color={appTheme.colors.error ?? '#EF4444'} />
              <Text style={{ fontWeight: '600', color: appTheme.colors.text }}>
                Error al confirmar la entrega
              </Text>
            </View>
            <BodyText>{feedback}</BodyText>
          </InfoCard>
        ) : null}

        {medicalForm.preguntas.map((q, idx) => {
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
                Pregunta {idx + 1} de {medicalForm.preguntas.length}
              </Text>
              <Text style={styles.questionTitle}>{q.pregunta}</Text>
              <DetailRow label="Respuesta" value={displayVal} />
            </InfoCard>
          );
        })}

        <View style={styles.actions}>
          {!isConfirmed ? (
            <>
              <VisualButton
                label="Confirmar y registrar entrega"
                disabled={busy || !formStorageReady}
                onPress={handleConfirmSubmission}
              />
              <VisualButton
                label="Modificar respuestas"
                secondary
                disabled={busy}
                onPress={() => setIsReviewing(false)}
              />
            </>
          ) : (
            <>
              <VisualButton
                label="Volver a cuestionarios"
                disabled={busy}
                onPress={() => router.replace('/formulario')}
              />
              <VisualButton
                label="Ver en historial"
                secondary
                disabled={busy}
                onPress={() => router.replace('/formulario/historial')}
              />
            </>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={formDef.titulo}>
      <DemoBadge />
      <BodyText>{formDef.descripcion}</BodyText>

      {feedback ? (
        <InfoCard>
          <StatusPill>{feedback}</StatusPill>
        </InfoCard>
      ) : null}

      {medicalForm.preguntas.map((question, index) => {
        const error = validationErrors[question.id];
        return (
          <InfoCard key={question.id}>
            <Text style={styles.questionNumber}>
              Pregunta {index + 1} de {medicalForm.preguntas.length}{' '}
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
          label="Revisar y completar"
          disabled={busy || !formStorageReady}
          onPress={handleReview}
        />
        <VisualButton
          label="Guardar borrador local"
          secondary
          disabled={busy || !formStorageReady}
          onPress={handleSaveDraft}
        />
        <VisualButton
          label="Descartar borrador"
          secondary
          disabled={busy || !formStorageReady}
          onPress={handleDiscard}
        />
      </View>
    </Screen>
  );
}

export function MedicalFormSubmissionsScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { repository, patientId } = useLocalData();

  const [submissions, setSubmissions] = useState<
    Array<{
      id: string;
      formulario_id: string;
      version: string;
      titulo: string;
      duracion_estimada_min: number;
      fecha_confirmacion: string;
      estado_envio: string | null;
    }>
  >([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);

  const fetchBatch = useCallback(
    async (offset: number) => {
      if (!repository || !patientId) return [];
      return repository.listSubmissions(undefined, 30, offset);
    },
    [repository, patientId],
  );

  useEffect(() => {
    let mounted = true;
    setLoadingInitial(true);
    setHistoryError(null);
    fetchBatch(0)
      .then((items) => {
        if (!mounted) return;
        setSubmissions(items);
        setHasMore(items.length === 30);
      })
      .catch((err) => {
        if (!mounted) return;
        setHistoryError(
          err instanceof Error ? err.message : 'Error al consultar el historial de evaluaciones.',
        );
      })
      .finally(() => {
        if (mounted) setLoadingInitial(false);
      });
    return () => {
      mounted = false;
    };
  }, [fetchBatch, historyAttempt]);

  async function handleLoadMore() {
    if (!repository || !patientId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextBatch = await fetchBatch(submissions.length);
      setSubmissions((prev) => [...prev, ...nextBatch]);
      setHasMore(nextBatch.length === 30);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : 'Error al cargar más evaluaciones del historial.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Screen title="Historial de evaluaciones">
      <DemoBadge />
      <BodyText>
        Registro de evaluaciones médicas confirmadas localmente en este dispositivo.
      </BodyText>

      {historyError ? (
        <InfoCard>
          <EmptyState
            icon="alert-circle"
            title="Error al consultar historial"
            description={historyError}
          />
          <View style={{ marginTop: theme.spacing.sm }}>
            <VisualButton
              label="Reintentar consulta"
              onPress={() => setHistoryAttempt((a) => a + 1)}
            />
          </View>
        </InfoCard>
      ) : null}

      {loadingInitial ? (
        <InfoCard>
          <StatusPill>Consultando historial…</StatusPill>
          <BodyText>Cargando evaluaciones previas registradas en este dispositivo…</BodyText>
        </InfoCard>
      ) : null}

      {!loadingInitial && !historyError && submissions.length === 0 ? (
        <InfoCard>
          <EmptyState
            icon="clipboard"
            title="Sin evaluaciones confirmadas"
            description="Las evaluaciones que completes y confirmes se listarán aquí."
          />
        </InfoCard>
      ) : null}

      {submissions.map((sub) => (
        <InfoCard key={sub.id}>
          <View style={styles.cardHeader}>
            <Feather name="check-circle" size={24} color={appTheme.colors.primary} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>{sub.titulo}</Text>
              <BodyText>
                Versión {sub.version} · Confirmado: {formatDate(sub.fecha_confirmacion)}
              </BodyText>
            </View>
          </View>

          <View style={styles.pillRow}>
            <StatusPill>Guardado en este dispositivo · Pendiente de envío</StatusPill>
          </View>

          <VisualButton
            label="Ver respuestas"
            secondary
            onPress={() => router.navigate(`/formulario/entrega?id=${encodeURIComponent(sub.id)}`)}
          />
        </InfoCard>
      ))}

      {hasMore ? (
        <View style={styles.actions}>
          <VisualButton
            label={loadingMore ? 'Cargando evaluaciones…' : 'Cargar evaluaciones anteriores'}
            secondary
            disabled={loadingMore}
            onPress={handleLoadMore}
          />
        </View>
      ) : null}
    </Screen>
  );
}

export function MedicalFormSubmissionDetailScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { repository, patientId } = useLocalData();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [submission, setSubmission] = useState<FormSubmissionDetail | null>(null);
  const [formDef, setFormDef] = useState<FullFormDefinition | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repository || !patientId || !id) return;
    let mounted = true;

    async function load() {
      setLoading(true);
      const sub = await repository!.getSubmission(id!);
      if (!mounted) return;
      setSubmission(sub);

      if (sub) {
        const def = await repository!.getFormDefinition(sub.formulario_id, sub.version);
        if (!mounted) return;
        setFormDef(def);
      }
      setLoading(false);
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [repository, patientId, id]);

  if (loading) {
    return (
      <Screen title="Detalle de evaluación">
        <DemoBadge />
        <InfoCard>
          <BodyText>Cargando respuestas registradas…</BodyText>
        </InfoCard>
      </Screen>
    );
  }

  if (!submission || !formDef) {
    return (
      <Screen title="Evaluación no encontrada">
        <DemoBadge />
        <EmptyState
          icon="alert-circle"
          title="Registro no disponible"
          description="No se encontró la entrega solicitada para este paciente."
        />
      </Screen>
    );
  }

  const medicalForm = toMedicalFormDefinition(formDef);

  return (
    <Screen title={`Entrega: ${submission.titulo}`}>
      <DemoBadge />
      <InfoCard>
        <StatusPill>Guardado en este dispositivo · Pendiente de envío</StatusPill>
        <DetailRow
          label="Fecha de confirmación"
          value={formatDate(submission.fecha_confirmacion)}
        />
        <DetailRow label="Versión evaluada" value={submission.version} />
        <DetailRow label="Identificador local" value={submission.id} />
      </InfoCard>

      <SectionTitle>Respuestas registradas</SectionTitle>

      {medicalForm.preguntas.map((q, idx) => {
        const val = submission.respuestas[q.id];
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
              Pregunta {idx + 1} de {medicalForm.preguntas.length}
            </Text>
            <Text style={styles.questionTitle}>{q.pregunta}</Text>
            <DetailRow label="Respuesta" value={displayVal} />
          </InfoCard>
        );
      })}

      <View style={styles.actions}>
        <VisualButton
          label="Volver al historial"
          onPress={() => router.replace('/formulario/historial')}
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
    cardActions: { gap: theme.spacing.xs, marginTop: theme.spacing.xs },
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
