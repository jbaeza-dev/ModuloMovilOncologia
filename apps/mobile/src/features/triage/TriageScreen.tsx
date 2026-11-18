import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Linking, View } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Screen } from '../../components/Screen';
import { DateTimePickerField } from '../../components/DateTimePickerField';
import {
  BodyText,
  ChoiceChip,
  FeedbackBanner,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { validateVitalInput } from '../../data/local/validation';
import { useLocalData } from '../../providers/LocalDataProvider';
import { getCivilPartsInTimeZone } from '../../services/reminders/reminder-status';
import {
  questions,
  type Answer,
  type Informant,
  type QuestionId,
  type TemperatureSite,
} from './triage-definition';
import { evaluateOrientation, type OrientationInput, type ResponseOrigin } from './triage-engine';
import { createOrientationRepository } from './triage-repository';

const outcomeTitles = {
  A1: 'Ayuda inmediata',
  A2: 'Valoración profesional urgente',
  B: 'Contacto prioritario con tu equipo',
  C: 'Seguimiento domiciliario condicionado',
  D: 'Información insuficiente',
} as const;
type HistoryItem = {
  id: string;
  created_at: string;
  definition_version: string;
  snapshot_json: string;
};

interface ParsedTriageHistory {
  outcome: 'A1' | 'A2' | 'B' | 'C' | 'D' | null;
  outcomeTitle: string;
  message: string;
  dateFormatted: string;
}

function parseHistoryItem(item: HistoryItem): ParsedTriageHistory {
  let outcome: 'A1' | 'A2' | 'B' | 'C' | 'D' | null = null;
  let message = 'Evaluación guardada en este teléfono.';
  try {
    const value = JSON.parse(item.snapshot_json);
    if (value && typeof value === 'object') {
      const res = value.result;
      if (res && typeof res === 'object') {
        if (res.outcome && typeof res.outcome === 'string' && res.outcome in outcomeTitles) {
          outcome = res.outcome as 'A1' | 'A2' | 'B' | 'C' | 'D';
        }
        if (res.message && typeof res.message === 'string') {
          message = res.message;
        }
      }
    }
  } catch {
    // Preserve default
  }
  const outcomeTitle =
    outcome && outcomeTitles[outcome] ? outcomeTitles[outcome] : 'Orientación clínica';
  const parts = getCivilPartsInTimeZone(item.created_at, 'America/Santiago');
  const dateFormatted = `${String(parts.day).padStart(2, '0')}-${String(parts.month).padStart(2, '0')}-${parts.year} ${parts.hourMinute} hrs`;

  return {
    outcome,
    outcomeTitle,
    message,
    dateFormatted,
  };
}

function storedMessage(item: HistoryItem): string {
  return parseHistoryItem(item).message;
}

export function TriageScreen() {
  const { database, patientId, clinicalStore, runSave, isClosing } = useLocalData();
  const epoch = `${patientId}:${clinicalStore?.scope.environment ?? ''}`;
  const [formEpoch, setFormEpoch] = useState(epoch);
  const [reviewStarted, setReviewStarted] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [answers, setAnswers] = useState<Partial<Record<QuestionId, Answer>>>({});
  const [origins, setOrigins] = useState<Partial<Record<QuestionId, ResponseOrigin>>>({});
  const [positiveSignals, setPositiveSignals] = useState<QuestionId[]>([]);
  const [informant, setInformant] = useState<Informant | null>(null);
  const [assisted, setAssisted] = useState<boolean | null>(null);
  const [caregiverSource, setCaregiverSource] = useState<'relayed' | 'observed' | 'unknown'>(
    'unknown',
  );
  const [pain, setPain] = useState('');
  const [painOrigin, setPainOrigin] = useState<ResponseOrigin | null>(null);
  const [temperature, setTemperature] = useState('');
  const [temperatureOrigin, setTemperatureOrigin] = useState<ResponseOrigin | null>(null);
  const [site, setSite] = useState<TemperatureSite>('unknown');
  const [device, setDevice] = useState('');
  const [treatmentDate, setTreatmentDate] = useState('');
  const [datePrecision, setDatePrecision] = useState<'exact' | 'approximate' | 'unknown'>(
    'unknown',
  );
  const [planDeclared, setPlanDeclared] = useState<Answer>('unknown');
  const [clarification, setClarification] = useState<OrientationInput['clarification']>();
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [continueAfterAlarm, setContinueAfterAlarm] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const identity = useRef(Crypto.randomUUID());
  const capturedAt = useRef<string | null>(null);
  const savingEpoch = useRef<string | null>(null);
  const previous = useRef<string | null>(null);
  const activeEpoch = useRef(epoch);
  const resetEvaluation = useCallback(() => {
    setReviewStarted(false);
    setHistoryLoaded(false);
    setAnswers({});
    setOrigins({});
    setPositiveSignals([]);
    setInformant(null);
    setAssisted(null);
    setCaregiverSource('unknown');
    setPain('');
    setPainOrigin(null);
    setTemperature('');
    setTemperatureOrigin(null);
    setSite('unknown');
    setDevice('');
    setTreatmentDate('');
    setDatePrecision('unknown');
    setPlanDeclared('unknown');
    setClarification(undefined);
    setClarifyOpen(false);
    setContinueAfterAlarm(false);
    setShowResult(false);
    setShowContacts(false);
    setBusy(false);
    setSaved(false);
    setError(null);
    setHistory([]);
    identity.current = Crypto.randomUUID();
    previous.current = null;
    capturedAt.current = null;
    savingEpoch.current = null;
  }, []);
  useEffect(() => {
    activeEpoch.current = epoch;
    resetEvaluation();
    setFormEpoch(epoch);
    return () => {
      activeEpoch.current = 'closed';
    };
  }, [epoch, resetEvaluation]);

  const painNumber = /^\d{1,2}$/.test(pain.trim()) ? Number(pain.trim()) : null;
  const painValid = painNumber !== null && painNumber >= 0 && painNumber <= 10;
  const painReported = painOrigin?.source === 'self' || painOrigin?.source === 'relayed';
  const temperatureCheck = validateVitalInput({
    temperature,
    pain,
    systolic: '',
    diastolic: '',
    pulse: '',
    saturation: '',
  });
  const measuredTemperature = temperatureCheck.values.temperatura;
  const today = getCivilPartsInTimeZone(new Date().toISOString(), 'America/Santiago').civilDate;
  const dateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(treatmentDate) &&
    Number.isFinite(Date.parse(treatmentDate)) &&
    new Date(treatmentDate).toISOString().slice(0, 10) === treatmentDate &&
    treatmentDate <= today;
  const input: OrientationInput = useMemo(
    () => ({
      answers,
      origins,
      positiveSignals,
      informant,
      ...(assisted === null ? {} : { assisted }),
      pain: painValid && painReported ? painNumber : null,
      painSource: painReported ? (painOrigin!.source as 'self' | 'relayed') : 'unavailable',
      measurementOrigins: { pain: painOrigin, temperature: temperatureOrigin },
      ...(((!painValid || !painReported) && pain.trim()) ||
      (temperature.trim() && measuredTemperature === null) ||
      (treatmentDate && !dateValid)
        ? {
            unconfirmedReadings: {
              ...((!painValid || !painReported) && pain.trim() ? { pain } : {}),
              ...(temperature.trim() && measuredTemperature === null ? { temperature } : {}),
              ...(treatmentDate && !dateValid ? { lastAdministration: treatmentDate } : {}),
            },
          }
        : {}),
      ...(temperature.trim() && measuredTemperature !== null && temperatureOrigin
        ? {
            temperature: {
              value: measuredTemperature,
              site,
              measuredAt: temperatureOrigin.at,
              ...(device.trim() ? { device: device.trim() } : {}),
            },
          }
        : {}),
      ...(temperature.trim() && measuredTemperature === null ? { unresolvedVitals: true } : {}),
      treatment: {
        lastAdministration: dateValid ? treatmentDate : null,
        precision: datePrecision,
        source: 'unknown',
      },
      palliativePlanDeclared: planDeclared,
      ...(clarification ? { clarification } : {}),
    }),
    [
      answers,
      origins,
      positiveSignals,
      informant,
      assisted,
      pain,
      painValid,
      painReported,
      painNumber,
      painOrigin,
      temperature,
      temperatureOrigin,
      measuredTemperature,
      site,
      device,
      treatmentDate,
      dateValid,
      datePrecision,
      planDeclared,
      clarification,
    ],
  );
  const result = useMemo(() => evaluateOrientation(input, 'synthetic'), [input]);
  const alarm = result.outcome === 'A1' || result.outcome === 'A2';
  const repository = useMemo(
    () =>
      database && patientId && clinicalStore?.scope.environment
        ? createOrientationRepository(database, {
            patientId,
            environment: clinicalStore.scope.environment,
          })
        : null,
    [database, patientId, clinicalStore?.scope.environment],
  );
  const clarificationQuestion = questions.find((q) => result.missing.includes(q.id));
  function edited() {
    setSaved(false);
    setError(null);
    identity.current = Crypto.randomUUID();
    capturedAt.current = null;
  }
  function origin(numericPain = false): ResponseOrigin {
    return {
      role: informant,
      source:
        informant === 'PACIENTE'
          ? 'self'
          : informant === 'CUIDADOR_FAMILIAR'
            ? numericPain && caregiverSource !== 'relayed'
              ? 'unknown'
              : caregiverSource
            : 'unknown',
      at: new Date().toISOString(),
    };
  }
  function answer(id: QuestionId, value: Answer) {
    edited();
    setAnswers((old) => ({ ...old, [id]: value }));
    setOrigins((old) => ({ ...old, [id]: origin() }));
    if (value === 'yes' && (id.startsWith('A1-') || id.startsWith('A2-')))
      setPositiveSignals((old) => (old.includes(id) ? old : [...old, id]));
  }
  async function contact(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setError(
        'No se pudo abrir el marcador. Puedes usar otro teléfono o pedir ayuda a un acompañante.',
      );
    }
  }
  async function save(): Promise<boolean> {
    if (!repository || busy || isClosing || savingEpoch.current === epoch) return false;
    if (saved) return true;
    const capturedEpoch = epoch;
    const id = identity.current;
    const timestamp = capturedAt.current ?? new Date().toISOString();
    capturedAt.current = timestamp;
    savingEpoch.current = capturedEpoch;
    setBusy(true);
    setError(null);
    try {
      await runSave(() => repository.save(id, input, 'synthetic', timestamp, previous.current));
      if (activeEpoch.current !== capturedEpoch) return false;
      previous.current = id;
      if (identity.current === id) setSaved(true);
      return true;
    } catch {
      if (activeEpoch.current === capturedEpoch)
        setError('No se pudo guardar esta evaluación. La orientación permanece visible.');
      return false;
    } finally {
      if (savingEpoch.current === capturedEpoch) savingEpoch.current = null;
      if (activeEpoch.current === capturedEpoch) setBusy(false);
    }
  }
  async function loadHistory() {
    if (!repository || busy) return;
    const capturedEpoch = epoch;
    setBusy(true);
    try {
      const items = await repository.history('synthetic');
      if (activeEpoch.current === capturedEpoch) {
        setHistory(items);
        setHistoryLoaded(true);
      }
    } catch {
      if (activeEpoch.current === capturedEpoch)
        setError('No se pudo consultar el historial. Se conservan las evaluaciones.');
    } finally {
      if (activeEpoch.current === capturedEpoch) setBusy(false);
    }
  }
  function startAnotherCase() {
    if (saved) {
      resetEvaluation();
      return;
    }
    Alert.alert(
      '¿Empezar otro caso?',
      'Este caso aún no está guardado. Puedes volver para guardarlo o empezar otro descartando solo estas respuestas.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Empezar sin guardar',
          style: 'destructive',
          onPress: () => {
            if (activeEpoch.current === epoch) resetEvaluation();
          },
        },
      ],
    );
  }
  const contacts = (
    <InfoCard>
      <SectionTitle>Contactos de ayuda</SectionTitle>
      <BodyText>SAMU: 131. Salud Responde: 600 360 7777.</BodyText>
      <BodyText>
        Estos botones abren el marcador. La aplicación no confirma que se haya realizado una llamada
        ni avisado a un profesional.
      </BodyText>
      <VisualButton
        label="Abrir marcador: SAMU 131"
        onPress={() => void contact('tel:131')}
        secondary
      />
      <VisualButton
        label="Abrir marcador: Salud Responde"
        onPress={() => void contact('tel:6003607777')}
        secondary
      />
    </InfoCard>
  );
  const warning = (
    <View style={{ marginBottom: 8, alignItems: 'flex-start', gap: 6 }}>
      <StatusPill>Orientación clínica de síntomas</StatusPill>
      {/* RNF-08: aviso visible en todas las pantallas de la orientación. */}
      <BodyText style={{ fontSize: 14 }}>
        Orientación de apoyo: no entrega diagnósticos y no reemplaza la atención de tu equipo de
        salud.
      </BodyText>
    </View>
  );
  const resultCard = result.outcome ? (
    <InfoCard>
      <StatusPill
        variant={alarm ? 'danger' : 'default'}
      >{`Nivel ${result.outcome} · ${outcomeTitles[result.outcome]}`}</StatusPill>
      <SectionTitle>{outcomeTitles[result.outcome]}</SectionTitle>
      <BodyText>{result.message}</BodyText>
      <BodyText>
        {result.complete
          ? 'Evaluación completada.'
          : 'Evaluación con respuestas pendientes; se conservan las señales conocidas.'}
      </BodyText>
      {result.outcome === 'D' ? (
        <>
          <BodyText>
            Puedes pedir orientación desde ahora o aclarar voluntariamente un dato. No necesitas
            repetir el formulario.
          </BodyText>
          {result.clarificationOffered ? (
            <VisualButton
              label="Aclarar un dato (opcional)"
              secondary
              onPress={() => {
                if (clarificationQuestion) setClarifyOpen(true);
                else {
                  edited();
                  setClarification({
                    attempted: true,
                    question: 'not-resolvable-here',
                    answer: 'unknown',
                  });
                }
              }}
            />
          ) : (
            <BodyText>
              La aclaración no resolvió todos los datos. Puedes usar los contactos de ayuda o seguir
              editando por voluntad propia.
            </BodyText>
          )}
          {clarifyOpen && clarificationQuestion ? (
            <>
              <BodyText>{clarificationQuestion.text}</BodyText>
              {(
                [
                  ['yes', 'Sí'],
                  ['no', 'No'],
                  ['unknown', 'No sé'],
                ] as const
              ).map(([value, label]) => (
                <ChoiceChip
                  key={value}
                  label={`Aclaración: ${label}`}
                  accessibilityLabel={`Aclaración: ${label}, ${clarificationQuestion.text}`}
                  selected={false}
                  disabled={busy}
                  onPress={() => {
                    answer(clarificationQuestion.id, value);
                    setClarification({
                      attempted: true,
                      question: clarificationQuestion.id,
                      answer: value,
                    });
                    setClarifyOpen(false);
                  }}
                />
              ))}
            </>
          ) : null}
          <VisualButton
            label="Salir y conservar evaluación"
            disabled={busy || !repository}
            secondary
            onPress={() => {
              void save().then((ok) => {
                if (ok && activeEpoch.current === epoch) router.back();
              });
            }}
          />
        </>
      ) : null}
      <VisualButton
        label={saved ? 'Evaluación guardada' : busy ? 'Guardando…' : 'Guardar evaluación'}
        disabled={busy || saved || !repository}
        onPress={() => void save()}
      />
      <VisualButton
        label="Empezar otra evaluación"
        secondary
        disabled={busy || isClosing}
        onPress={startAnotherCase}
      />
    </InfoCard>
  ) : null;
  if (formEpoch !== epoch)
    return (
      <Screen title="Orientación de síntomas">
        <BodyText>Preparando tu contexto…</BodyText>
      </Screen>
    );
  if (!reviewStarted)
    return (
      <Screen title="Orientación de síntomas" mascotPose="resumen">
        {warning}
        <InfoCard>
          <SectionTitle>Orientación y triaje de síntomas</SectionTitle>
          <BodyText>
            Esta guía te orienta paso a paso según tus síntomas actuales y te indica el nivel de
            atención que necesitas.
          </BodyText>
          <BodyText>
            Esta evaluación tiene sus propias respuestas. El seguimiento diario y los signos vitales
            se mantienen separados.
          </BodyText>
          <BodyText>
            Responde con calma a las preguntas. Al terminar, la aplicación te entregará la
            recomendación clínica y los contactos de asistencia disponibles.
          </BodyText>
          <VisualButton
            label="Comenzar orientación de síntomas"
            onPress={() => setReviewStarted(true)}
            disabled={isClosing}
          />
        </InfoCard>

        {/* Historial de orientaciones antes de iniciar una nueva */}
        <SectionTitle>Historial de orientaciones</SectionTitle>
        <BodyText>
          Evaluaciones previas y calificaciones de triaje registradas en este teléfono:
        </BodyText>
        {!historyLoaded ? (
          <VisualButton
            label="Consultar historial de orientaciones"
            disabled={busy || !repository}
            secondary
            onPress={() => void loadHistory()}
          />
        ) : null}
        {historyLoaded && history.length === 0 ? (
          <InfoCard>
            <BodyText>Aún no hay evaluaciones guardadas en este dispositivo.</BodyText>
          </InfoCard>
        ) : null}
        {history.map((item) => {
          const parsed = parseHistoryItem(item);
          const isUrgent = parsed.outcome === 'A1' || parsed.outcome === 'A2';
          return (
            <InfoCard key={item.id}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                  flexWrap: 'wrap',
                  gap: 4,
                }}
              >
                <StatusPill variant={isUrgent ? 'danger' : 'default'}>
                  {parsed.outcome
                    ? `Nivel ${parsed.outcome} · ${parsed.outcomeTitle}`
                    : 'Orientación guardada'}
                </StatusPill>
                <BodyText style={{ fontSize: 12, color: '#64748B', fontWeight: '600' }}>
                  {parsed.dateFormatted}
                </BodyText>
              </View>
              <SectionTitle>{parsed.outcomeTitle}</SectionTitle>
              <BodyText>{parsed.message}</BodyText>
            </InfoCard>
          );
        })}

        {contacts}
        {error ? <BodyText>{error}</BodyText> : null}
      </Screen>
    );
  if (showContacts)
    return (
      <Screen
        title="Contactos de ayuda"
        mascotPose="resumen"
        fixedHeader={
          <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
            <VisualButton
              label="Volver a mis respuestas"
              onPress={() => setShowContacts(false)}
              secondary
            />
          </View>
        }
      >
        {warning}
        {contacts}
        {error ? <BodyText>{error}</BodyText> : null}
      </Screen>
    );
  if ((alarm && !continueAfterAlarm) || showResult)
    return (
      <Screen
        key="orientation-result"
        title="Orientación de síntomas"
        mascotPose="resumen"
        fixedHeader={
          <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
            <VisualButton
              label={alarm ? 'Revisar respuestas ingresadas' : 'Volver a mis respuestas'}
              secondary
              onPress={() => {
                setShowResult(false);
                if (alarm) setContinueAfterAlarm(true);
              }}
            />
          </View>
        }
      >
        {warning}
        {resultCard}
        {contacts}
        {error ? <BodyText>{error}</BodyText> : null}
      </Screen>
    );
  return (
    <Screen
      key="orientation-answers"
      title="Orientación de síntomas"
      mascotPose="resumen"
      fixedHeader={
        <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
          {alarm ? (
            <VisualButton
              label="Volver a la orientación urgente"
              onPress={() => setContinueAfterAlarm(false)}
            />
          ) : (
            <VisualButton
              label="Ver contactos de ayuda"
              onPress={() => setShowContacts(true)}
              secondary
            />
          )}
        </View>
      }
    >
      {warning}
      {alarm ? resultCard : null}
      <SectionTitle>¿Quién responde sobre los síntomas?</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ChoiceChip
          label="Paciente"
          selected={informant === 'PACIENTE'}
          disabled={busy}
          onPress={() => {
            edited();
            setInformant('PACIENTE');
          }}
        />
        <ChoiceChip
          label="Cuidador o familiar"
          selected={informant === 'CUIDADOR_FAMILIAR'}
          disabled={busy}
          onPress={() => {
            edited();
            setInformant('CUIDADOR_FAMILIAR');
          }}
        />
      </View>
      <BodyText>
        Si alguien solo lee o toca por el paciente, el informante sigue siendo el paciente.
      </BodyText>
      {informant === 'CUIDADOR_FAMILIAR' ? (
        <InfoCard>
          <BodyText>¿De dónde provienen las próximas respuestas?</BodyText>
          <ChoiceChip
            label="Transmito lo que dijo el paciente"
            selected={caregiverSource === 'relayed'}
            disabled={busy}
            onPress={() => setCaregiverSource('relayed')}
          />
          <ChoiceChip
            label="Describo lo que observo"
            selected={caregiverSource === 'observed'}
            disabled={busy}
            onPress={() => setCaregiverSource('observed')}
          />
          <BodyText>
            La ENA debe provenir del paciente. No inventes un número si no puede expresarlo. Un
            cambio de fuente no modifica las respuestas anteriores.
          </BodyText>
        </InfoCard>
      ) : null}
      <ChoiceChip
        label="Con ayuda de lectura o toques"
        selected={assisted === true}
        disabled={busy}
        onPress={() => {
          edited();
          setAssisted(true);
        }}
      />
      <ChoiceChip
        label="Sin ayuda de lectura o toques"
        selected={assisted === false}
        disabled={busy}
        onPress={() => {
          edited();
          setAssisted(false);
        }}
      />
      {questions.map((question) => (
        <InfoCard key={question.id}>
          <BodyText>{question.text}</BodyText>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={question.text}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
          >
            {(
              [
                ['yes', 'Sí'],
                ['no', 'No'],
                ['unknown', 'No sé'],
              ] as const
            ).map(([value, label]) => (
              <ChoiceChip
                key={value}
                label={label}
                // Al recorrer botón por botón, TalkBack anuncia también la pregunta que responde.
                accessibilityLabel={`${label}, ${question.text}`}
                selected={answers[question.id] === value}
                disabled={busy}
                onPress={() => answer(question.id, value)}
              />
            ))}
          </View>
        </InfoCard>
      ))}
      <VisualField
        label="Nivel de dolor (escala 0 a 10)"
        value={pain}
        keyboardType="number-pad"
        maxLength={2}
        editable={!busy}
        onChangeText={(value) => {
          if (!/^(?:10|[0-9])?$/.test(value)) return;
          edited();
          setPain(value);
          setPainOrigin(origin(true));
        }}
        helperText="0 = sin dolor; 10 = máximo dolor imaginable. Indica primero quién responde y registra el número que comunicó el paciente."
        errorText={
          pain.trim() && (!painValid || !painReported)
            ? 'La ENA debe ser un entero de 0 a 10 comunicado por el paciente; si no se obtuvo, déjala sin completar.'
            : undefined
        }
      />
      <SectionTitle>Mediciones y contexto opcionales de este episodio</SectionTitle>
      <VisualField
        label="Temperatura de este momento (°C)"
        value={temperature}
        keyboardType="decimal-pad"
        maxLength={4}
        editable={!busy}
        onChangeText={(value) => {
          if (!/^(?:\d{0,2}|\d{1,2}[.,]\d?)$/.test(value)) return;
          edited();
          setTemperature(value);
          setTemperatureOrigin(origin());
        }}
        helperText="Entrada de 30 a 45 °C, máximo un decimal; no es un rango de normalidad. No copies una lectura antigua como actual."
        errorText={temperatureCheck.errors.temperature}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(
          [
            ['axillary', 'Axilar'],
            ['oral', 'Oral'],
            ['tympanic', 'Timpánica'],
            ['other', 'Otra'],
            ['unknown', 'Sitio no conocido'],
          ] as const
        ).map(([value, label]) => (
          <ChoiceChip
            key={value}
            label={label}
            selected={site === value}
            disabled={busy}
            onPress={() => {
              edited();
              setSite(value);
            }}
          />
        ))}
      </View>
      <BodyText>
        Los umbrales clínicos por sitio y su uso con el tratamiento siguen pendientes de resolución.
        No se aplica una conversión automática de temperatura.
      </BodyText>
      <DateTimePickerField
        mode="date"
        label="Última quimioterapia administrada (opcional)"
        value={treatmentDate || null}
        maximumDate={new Date().toLocaleDateString('en-CA')}
        disabled={busy}
        onChange={(val) => {
          edited();
          setTreatmentDate(val);
        }}
      />
      <ChoiceChip
        label="Fecha exacta"
        selected={datePrecision === 'exact'}
        disabled={busy}
        onPress={() => {
          edited();
          setDatePrecision('exact');
        }}
      />
      <ChoiceChip
        label="Fecha aproximada"
        selected={datePrecision === 'approximate'}
        disabled={busy}
        onPress={() => {
          edited();
          setDatePrecision('approximate');
        }}
      />
      <InfoCard>
        <BodyText>
          ¿Tu equipo te entregó un plan escrito y vigente para actuar ante esta crisis en casa?
        </BodyText>
        {(
          [
            ['yes', 'Sí tengo un plan'],
            ['no', 'No tengo un plan'],
            ['unknown', 'No sé si tengo un plan'],
          ] as const
        ).map(([value, label]) => (
          <ChoiceChip
            key={value}
            label={label}
            selected={planDeclared === value}
            disabled={busy}
            onPress={() => {
              edited();
              setPlanDeclared(value);
            }}
          />
        ))}
        <BodyText>
          Declararlo no lo verifica digitalmente ni invalida indicaciones profesionales que tengas
          fuera de la app. La vía individual requiere un plan previamente verificado y aplicable;
          esa integración está pendiente.
        </BodyText>
      </InfoCard>
      <VisualButton
        label="Ver orientación"
        disabled={busy}
        onPress={() => {
          Keyboard.dismiss();
          setShowResult(true);
          void save().then(() => {
            setHistoryLoaded(false);
          });
        }}
      />
      {contacts}
      <VisualButton
        label="Consultar historial de orientaciones"
        disabled={busy || !repository}
        secondary
        onPress={() => void loadHistory()}
      />
      {historyLoaded && history.length === 0 ? (
        <BodyText>Aún no hay evaluaciones guardadas en este dispositivo.</BodyText>
      ) : null}
      {history.map((item) => (
        <InfoCard key={item.id}>
          <BodyText>Evaluación del {item.created_at}</BodyText>
          <BodyText>Edición conservada: {item.definition_version}</BodyText>
          <BodyText>{storedMessage(item)}</BodyText>
        </InfoCard>
      ))}
      {error ? (
        <FeedbackBanner variant="error" title="No se pudo completar la acción" message={error} />
      ) : null}
      <BodyText>Protocolo de triaje y orientación clínica de síntomas</BodyText>
    </Screen>
  );
}
