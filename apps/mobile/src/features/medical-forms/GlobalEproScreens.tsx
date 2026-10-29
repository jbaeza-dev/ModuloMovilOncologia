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
import { NavigationCard } from '../../components/NavigationCard';
import {
  BodyText,
  DetailRow,
  InfoCard,
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
    { repository, trackOperation, isClosing } = useLocalData();
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState('');
  const load = useCallback(async () => {
    if (!repo) return null;
    const hub = await repo.hub();
    const legacy = [];
    if (repository?.listAssignedForms && repository.getDailyFormStatus)
      for (const form of await repository.listAssignedForms()) {
        const status = await repository.getDailyFormStatus(form.formulario_id);
        for (const draft of [status.activeDraft, status.olderDraft])
          if (draft) legacy.push({ form, draft });
      }
    return { source: repo, hub, legacy };
  }, [repo, repository]);
  const { value, loading, error, refresh } = useFocusedValue(load, null);
  const data = value?.source === repo ? value : null;
  async function start() {
    if (!repo || !data?.hub.current || busy || isClosing) return;
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
    <Screen isRoot title="Seguimiento domiciliario">
      {data?.hub.current ? (
        <VisualButton
          label={busy ? 'Preparando…' : 'Iniciar seguimiento de hoy'}
          disabled={busy || isClosing}
          onPress={() => void start()}
        />
      ) : null}
      <BodyText>
        Cuestionario global para pacientes en quimioterapia. Tus respuestas se guardan en este
        dispositivo y se envían cuando la sesión y la conexión lo permiten.
      </BodyText>
      {loading || !repo ? <BodyText>Consultando el catálogo completo…</BodyText> : null}
      {error ? (
        <InfoCard>
          <BodyText>
            No se pudo consultar una definición compatible. Tus borradores e historial se conservan.
          </BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : null}
      {data?.hub.status?.completed_at ? (
        <BodyText>
          Última réplica completa: {formatDate(data.hub.status.completed_at)}.
          {data.hub.status.error_code
            ? ' Falló una actualización; se conserva la última copia completa.'
            : ''}{' '}
          Esta fecha no confirma conexión actual.
        </BodyText>
      ) : null}
      {data?.hub.current ? (
        <InfoCard>
          <SectionTitle>{String(data.hub.current.form.titulo)}</SectionTitle>
          <BodyText>{String(data.hub.current.form.descripcion ?? '')}</BodyText>
          <BodyText>
            Edición {String(data.hub.current.form.version)} · {data.hub.current.questions.length}{' '}
            preguntas, con preguntas condicionales.
          </BodyText>
        </InfoCard>
      ) : !loading && !error ? (
        <BodyText>
          Aún no hay un seguimiento global activo y completo disponible. Conéctate para recibirlo.
        </BodyText>
      ) : null}
      {feedback ? <Text accessibilityRole="alert">{feedback}</Text> : null}
      {data?.hub.drafts.map((draft) => (
        <InfoCard key={draft.id}>
          <SectionTitle>Borrador del {draft.context.fechaSeguimiento}</SectionTitle>
          <BodyText>
            Edición {String(draft.definition.form.version)}. Se conserva su definición original
            aunque llegue una edición nueva.
          </BodyText>
          <VisualButton
            label="Continuar borrador"
            secondary
            disabled={isClosing}
            onPress={() =>
              router.push({ pathname: '/formulario/cuestionario', params: { draft: draft.id } })
            }
          />
        </InfoCard>
      ))}
      {data?.legacy.map(({ form, draft }) => (
        <InfoCard key={draft.entrega_id}>
          <SectionTitle>Borrador anterior: {form.titulo}</SectionTitle>
          <BodyText>
            Se conserva su edición anterior {form.version}; no se convierte al nuevo instrumento.
          </BodyText>
          <VisualButton
            label="Abrir borrador anterior"
            secondary
            onPress={() =>
              router.push({
                pathname: '/formulario/cuestionario',
                params: {
                  id: form.formulario_id,
                  version: form.version,
                  periodoClave: draft.periodo_clave,
                },
              })
            }
          />
        </InfoCard>
      ))}
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
        title="Historial de evaluaciones"
        icon="clipboard"
        href="/formulario/historial"
      />
      <NavigationCard
        title="Historial de síntomas libres"
        icon="file-text"
        href="/formulario/sintomas-libres"
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
              'No se encontró este borrador. Consulta el historial si ya lo confirmaste.',
            );
          setLoaded({ source: repo, draft });
          answersRef.current = draft.answers;
          setAnswers(draft.answers);
          setSection(draft.section);
        })
        .catch((error) => {
          if (active)
            setError(error instanceof Error ? error.message : 'No se pudo abrir el borrador.');
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
        AccessibilityInfo.announceForAccessibility(
          'No se pudo guardar el borrador. Reintenta antes de salir.',
        );
      },
    );
  });
  useEffect(() => {
    if (pendingAction) navigation.dispatch(pendingAction);
  }, [pendingAction, navigation]);
  if (loading || !repo)
    return (
      <Screen title="Seguimiento domiciliario">
        <BodyText>Abriendo el borrador cifrado…</BodyText>
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
    >
      <BodyText>
        Seguimiento del {draft.context.fechaSeguimiento} · edición{' '}
        {String(draft.definition.form.version)}. Ventana de referencia:{' '}
        {formatDate(draft.context.ventanaDesde)} a {formatDate(draft.context.ventanaHasta)}.
      </BodyText>
      <StatusPill>
        {pending
          ? 'Guardando borrador…'
          : saveError
            ? 'Guardado pendiente'
            : 'Borrador guardado en este dispositivo'}
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
            label={
              currentIndex === sections.length - 1 ? 'Revisar respuestas' : 'Guardar y continuar'
            }
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
        <BodyText>No se pudo leer el snapshot de la captura.</BodyText>
      </Screen>
    );
  if (!value.capture) return <MedicalFormSubmissionDetailScreen />;
  const { record, status } = value.capture,
    edition = contractForm(record.definition);
  return (
    <Screen title="Seguimiento confirmado">
      <BodyText>
        Seguimiento del {record.context.fechaSeguimiento} · confirmado el{' '}
        {formatDate(record.submittedAt)}.
      </BodyText>
      <BodyText>
        Edición {String(record.definition.form.version)}. Se muestra su definición original.
      </BodyText>
      <StatusPill>{clinicalStatusLabel(status)}</StatusPill>
      <BodyText>
        La confirmación del servidor indica recepción del registro; no implica evaluación clínica.
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
