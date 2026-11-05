import { createDailyFormContext } from '../../services/forms/daily-form-context';
import {
  activeQuestionIds,
  answerErrors,
  visibleAnswers,
  type AnswerValue,
  type FormQuestion,
} from '@quimiocare/contracts/forms';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Text } from 'react-native';
import { Screen } from '../../components/Screen';
import { MascotHero } from '../../components/MascotAvatar';
import { NavigationCard } from '../../components/NavigationCard';
import {
  BodyText,
  DetailRow,
  InfoCard,
  ProgressBar,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { formatDate } from '../../data/local/repository';
import { contractForm, formSections } from '../../data/sync/contract-form';
import type { EproDraft } from '../../data/sync/epro-repository';
import { clinicalStatusLabel } from '../../data/sync/visible-status';
import { ContractQuestionInput } from './ContractQuestionInput';
import { useEproRepository } from './use-epro-repository';
import { FormSectionScreen } from './FormSectionScreen';
import { MedicalFormSubmissionDetailScreen } from './MedicalFormsScreens';

function answerLabel(q: FormQuestion, value: AnswerValue | undefined): string {
  if (value === undefined || value === null || value === '') return 'Sin respuesta';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const option = (code: string) => q.opciones?.find((o) => o.codigo === code)?.etiqueta ?? code;
  return Array.isArray(value)
    ? value.map(option).join('; ')
    : typeof value === 'number'
      ? String(value)
      : q.tipo === 'texto_libre'
        ? value
        : option(value);
}
export function GlobalEproHubScreen() {
  const repo = useEproRepository(),
    { trackOperation, isClosing } = useLocalData();
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState('');
  const load = useCallback(async () => {
    if (!repo) return null;
    const hub = await repo.hub();
    return { source: repo, hub };
  }, [repo]);
  const { value, loading, error, refresh } = useFocusedValue(load, null);
  const data = value?.source === repo ? value : null;
  const today = createDailyFormContext().fechaSeguimiento;
  const continuation = data?.hub.drafts.find(
    (draft) =>
      (!data.hub.current || draft.definition.form.codigo === data.hub.current.form.codigo) &&
      draft.context.fechaSeguimiento === today,
  );
  const progressLabel = (draft: EproDraft) => {
    const steps = formSections(draft.definition);
    const index = Math.max(
      0,
      steps.findIndex((step) => step.id === draft.section),
    );
    return `Paso ${index + 1} de ${steps.length} · ${steps[index]?.titulo ?? 'Tu seguimiento'}`;
  };
  async function start() {
    if (!repo || !data || (!data.hub.current && !continuation) || busy || isClosing) return;
    if (continuation) {
      router.push({ pathname: '/formulario/cuestionario', params: { draft: continuation.id } });
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const draft = await trackOperation(() => repo.start(String(data.hub.current!.form.id)));
      router.push({ pathname: '/formulario/cuestionario', params: { draft: draft.id } });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo iniciar el seguimiento.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen isRoot showHelp showProfile>
      <MascotHero
        pose="registro"
        eyebrow="SEGUIMIENTO DOMICILIARIO"
        title="¿Cómo te has sentido?"
        description="A tu ritmo. Puedes pausar y continuar después."
        compact
      />
      <BodyText>Se guarda en este teléfono. Los envíos pendientes requieren conexión.</BodyText>
      {loading || !repo ? <BodyText>Buscando tu cuestionario…</BodyText> : null}
      {error ? (
        <InfoCard>
          <BodyText>
            No pudimos abrir tu cuestionario. Tus respuestas e historial se conservan.
          </BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : null}
      {data?.hub.status?.completed_at ? (
        <BodyText>
          Cuestionario recibido: {formatDate(data.hub.status.completed_at)}.
          {data.hub.status.error_code ? ' No se pudo actualizar. Se conserva la última copia.' : ''}
        </BodyText>
      ) : null}
      {data?.hub.current || continuation ? (
        <InfoCard>
          <SectionTitle>
            {String((continuation?.definition ?? data?.hub.current)?.form.titulo)}
          </SectionTitle>
          <BodyText>
            {String((continuation?.definition ?? data?.hub.current)?.form.descripcion ?? '')}
          </BodyText>
          <BodyText>
            Edición {String((continuation?.definition ?? data?.hub.current)?.form.version)} ·{' '}
            {(continuation?.definition ?? data?.hub.current)?.questions.length} preguntas
          </BodyText>
          {continuation ? <BodyText>{progressLabel(continuation)}</BodyText> : null}
          <VisualButton
            label={busy ? 'Abriendo…' : 'Iniciar seguimiento'}
            disabled={busy || isClosing}
            onPress={() => void start()}
          />
        </InfoCard>
      ) : !loading && !error ? (
        <InfoCard>
          <SectionTitle>Todavía no tienes un cuestionario disponible</SectionTitle>
          <BodyText>
            Conéctate para recibirlo por primera vez. Si ya tienes conexión, revisa tu vinculación
            con el equipo de salud.
          </BodyText>
          <VisualButton label="Volver a consultar" secondary onPress={refresh} />
          <NavigationCard
            title="Revisar mi vinculación"
            icon="link-2"
            href="/perfil/vinculacion"
            compact
          />
        </InfoCard>
      ) : null}
      {feedback ? <Text accessibilityRole="alert">{feedback}</Text> : null}
      {data?.hub.captures.slice(0, 10).map((capture) => (
        <InfoCard key={capture.id}>
          <SectionTitle>Seguimiento del {capture.context.fechaSeguimiento}</SectionTitle>
          <BodyText>
            Confirmado el {formatDate(capture.submittedAt)} · edición{' '}
            {String(capture.definition.form.version)}
          </BodyText>
          <VisualButton
            label="Ver captura"
            secondary
            onPress={() =>
              router.push({ pathname: '/formulario/entrega', params: { id: capture.id } })
            }
          />
        </InfoCard>
      ))}
      <NavigationCard
        title="Orientación de síntomas · Demostración"
        description="Consulta interactiva para evaluar tus síntomas con IA"
        icon="message-circle"
        href="/asistente"
        compact
      />
      <NavigationCard
        title="Historial de evaluaciones"
        icon="clipboard"
        href="/formulario/historial"
      />
    </Screen>
  );
}
export function EproQuestionnaireRoute() {
  const params = useLocalSearchParams<{ draft?: string; id?: string }>();
  return params.draft ? (
    <ContractEproEditor draftId={params.draft} />
  ) : params.id ? (
    <FormSectionScreen />
  ) : (
    <GlobalEproHubScreen />
  );
}
export function ContractEproEditor({ draftId }: { draftId: string }) {
  const repo = useEproRepository(),
    { trackOperation, isClosing } = useLocalData(),
    navigation = useNavigation();
  const [loaded, setLoaded] = useState<{ source: typeof repo; draft: EproDraft } | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({}),
    [section, setSection] = useState('');
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [saveError, setSaveError] = useState('');
  const [pending, setPending] = useState(false),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    Parameters<typeof navigation.dispatch>[0] | null
  >(null);
  const answersRef = useRef<Record<string, AnswerValue>>({});
  const latest = useRef(0),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    mounted = useRef(true);
  const draft = loaded?.source === repo ? loaded.draft : null;
  const edition = useMemo(() => (draft ? contractForm(draft.definition) : null), [draft]);
  const sections = useMemo(() => (draft ? formSections(draft.definition) : []), [draft]);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    setLoading(true);
    setLoaded(null);
    setError('');
    if (repo)
      void repo
        .draft(draftId)
        .then((draft) => {
          if (!active) return;
          if (!draft)
            throw new Error(
              'No se encontró este seguimiento. Consulta el historial si ya lo confirmaste.',
            );
          setLoaded({ source: repo, draft });
          answersRef.current = draft.answers;
          setAnswers(draft.answers);
          setSection(draft.section);
        })
        .catch((error) => {
          if (active)
            setError(
              error instanceof Error ? error.message : 'No se pudieron recuperar tus respuestas.',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [repo, draftId]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queue.current.catch(() => undefined);
    });
    return () => sub.remove();
  }, []);
  function save(next: Record<string, AnswerValue>, step: string) {
    if (!repo || !draft || isClosing)
      return Promise.reject(new Error('El contexto no está disponible.'));
    const sequence = ++latest.current,
      previous = queue.current;
    setPending(true);
    setSaveError('');
    const job = trackOperation(async () => {
      await previous.catch(() => undefined);
      if (sequence !== latest.current) return;
      await repo.save(draft.id, next, step);
    });
    queue.current = job;
    void job.then(
      () => {
        if (mounted.current && sequence === latest.current) {
          setPending(false);
          setSaveError('');
        }
      },
      (error) => {
        if (mounted.current && sequence === latest.current) {
          setPending(false);
          setSaveError(error instanceof Error ? error.message : 'No se pudo guardar.');
        }
      },
    );
    return job;
  }
  usePreventRemove((pending || !!saveError) && !isClosing && !pendingAction, ({ data }) => {
    void queue.current.then(
      () => setPendingAction(data.action),
      () => {
        AccessibilityInfo.announceForAccessibility('No se pudo guardar. Reintenta antes de salir.');
      },
    );
  });
  useEffect(() => {
    if (pendingAction) navigation.dispatch(pendingAction);
  }, [pendingAction, navigation]);
  if (loading || !repo)
    return (
      <Screen title="Seguimiento domiciliario">
        <BodyText>Recuperando tus respuestas…</BodyText>
      </Screen>
    );
  if (error || !draft || !edition)
    return (
      <Screen title="Seguimiento domiciliario">
        <BodyText>{error || 'No se dispone de una definición compatible.'}</BodyText>
      </Screen>
    );
  const input = Object.entries(answers).map(([pregunta_id, valor]) => ({ pregunta_id, valor }));
  const active = activeQuestionIds(edition, input),
    issues = answerErrors(edition, visibleAnswers(edition, input));
  const currentIndex = Math.max(
      0,
      sections.findIndex((s) => s.id === section),
    ),
    current = sections[currentIndex];
  const inSection = (q: FormQuestion) =>
    String(q.configuracion?.modulo ?? 'general') === current.id;
  const visible = edition.preguntas.filter((q) => active.has(q.id));
  const sectionIssues = issues.filter((issue) =>
    visible.some((q) => q.id === issue.details.pregunta_id && inSection(q)),
  );
  async function next() {
    if (busy) return;
    setShowErrors(true);
    if (sectionIssues.length) {
      AccessibilityInfo.announceForAccessibility(sectionIssues[0].message);
      return;
    }
    setBusy(true);
    try {
      const nextSection = sections[currentIndex + 1];
      await save(answers, nextSection?.id ?? current.id);
      if (nextSection) {
        setSection(nextSection.id);
        setShowErrors(false);
      } else if (issues.length) {
        setSection(
          String(
            edition!.preguntas.find((q) => q.id === issues[0].details.pregunta_id)?.configuracion
              ?.modulo ?? sections[0].id,
          ),
        );
        AccessibilityInfo.announceForAccessibility(issues[0].message);
      } else setReview(true);
    } catch {
      /* The durable save error remains visible. */
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!repo || !draft || busy || isClosing) return;
    setBusy(true);
    try {
      await queue.current;
      await trackOperation(() => repo.submit(draft.id));
      router.replace({ pathname: '/formulario/entrega', params: { id: draft.id } });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo confirmar la captura.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      key={review ? 'review' : current.id}
      title={review ? 'Revisar seguimiento' : current.titulo}
      mascotPose={review ? 'explicacion' : undefined}
    >
      <BodyText>
        Seguimiento del {draft.context.fechaSeguimiento} · edición{' '}
        {String(draft.definition.form.version)}.
      </BodyText>
      <StatusPill>
        {pending ? 'Guardando…' : saveError ? 'Guardado pendiente' : 'Guardado automáticamente'}
      </StatusPill>
      {saveError ? (
        <InfoCard>
          <Text accessibilityRole="alert">{saveError}</Text>
          <VisualButton
            label="Reintentar guardado"
            disabled={busy || isClosing}
            onPress={() => void save(answers, section).catch(() => undefined)}
          />
        </InfoCard>
      ) : null}
      {review ? (
        <>
          <BodyText>
            Revisa tus respuestas. Solo se confirman las preguntas que corresponden. El comentario
            final forma parte del seguimiento.
          </BodyText>
          {visible
            .filter((q) => answers[q.id] !== undefined)
            .map((q) => (
              <DetailRow
                key={q.id}
                label={q.titulo}
                value={answerLabel(q, answers[q.id])}
                layout="vertical"
              />
            ))}
          <VisualButton
            label={busy ? 'Confirmando…' : 'Confirmar seguimiento completo'}
            disabled={busy || pending || !!saveError || isClosing}
            onPress={() => void confirm()}
          />
          <VisualButton
            label="Volver a editar"
            secondary
            disabled={busy}
            onPress={() => setReview(false)}
          />
        </>
      ) : (
        <>
          <BodyText>
            Paso {currentIndex + 1} de {sections.length}. Se muestran las preguntas que corresponden
            a tus respuestas.
          </BodyText>
          <ProgressBar progress={Math.round(((currentIndex + 1) / sections.length) * 100)} />
          {visible.filter(inSection).map((q) => (
            <ContractQuestionInput
              key={q.id}
              question={q}
              value={answers[q.id]}
              disabled={busy || isClosing}
              error={
                showErrors
                  ? issues.find((error) => error.details.pregunta_id === q.id)?.message
                  : undefined
              }
              onChange={(value) => {
                const next = { ...answersRef.current, [q.id]: value };
                answersRef.current = next;
                setAnswers(next);
                setShowErrors(true);
                void save(next, section).catch(() => undefined);
              }}
            />
          ))}
          <VisualButton
            label={currentIndex === sections.length - 1 ? 'Revisar respuestas' : 'Continuar'}
            disabled={busy || isClosing}
            onPress={() => void next()}
          />
          {currentIndex > 0 ? (
            <VisualButton
              label="Paso anterior"
              secondary
              disabled={busy || isClosing}
              onPress={() => {
                const previous = sections[currentIndex - 1].id;
                setSection(previous);
                setShowErrors(false);
                void save(answers, previous).catch(() => undefined);
              }}
            />
          ) : null}
          <VisualButton
            label="Pausar y seguir más tarde"
            secondary
            disabled={busy || isClosing}
            onPress={() => {
              setBusy(true);
              void save(answersRef.current, section)
                .then(() => {
                  if (mounted.current) router.replace('/formulario');
                })
                .catch(() => undefined)
                .finally(() => {
                  if (mounted.current) setBusy(false);
                });
            }}
          />
        </>
      )}
    </Screen>
  );
}
export function EproSubmissionRoute() {
  const repo = useEproRepository(),
    { id } = useLocalSearchParams<{ id?: string }>();
  const load = useCallback(
    async () => ({ source: repo, capture: repo && id ? await repo.capture(id) : null }),
    [repo, id],
  );
  const { value, loading, error } = useFocusedValue(load, null);
  if (loading || value?.source !== repo)
    return (
      <Screen title="Detalle de evaluación">
        <BodyText>Consultando la captura…</BodyText>
      </Screen>
    );
  if (error)
    return (
      <Screen title="Detalle de evaluación">
        <BodyText>No se pudieron abrir las respuestas guardadas.</BodyText>
      </Screen>
    );
  if (!value.capture) return <MedicalFormSubmissionDetailScreen />;
  const { record, status } = value.capture,
    edition = contractForm(record.definition);
  return (
    <Screen mascotPose="confirmacion" title="Seguimiento confirmado">
      <BodyText>
        Seguimiento del {record.context.fechaSeguimiento} · confirmado el{' '}
        {formatDate(record.submittedAt)}.
      </BodyText>
      <BodyText>
        Edición {String(record.definition.form.version)}. Se muestra su definición original.
      </BodyText>
      <StatusPill>{clinicalStatusLabel(status)}</StatusPill>
      <BodyText>
        Recibido significa que tu registro llegó; no significa que tu equipo de salud ya lo haya
        revisado.
      </BodyText>
      {edition.preguntas
        .filter((q) => Object.hasOwn(record.answers, q.id))
        .map((q) => (
          <DetailRow
            key={q.id}
            label={q.titulo}
            value={answerLabel(q, record.answers[q.id])}
            layout="vertical"
          />
        ))}
      <VisualButton
        label="Volver al seguimiento"
        secondary
        onPress={() => router.replace('/formulario')}
      />
    </Screen>
  );
}
