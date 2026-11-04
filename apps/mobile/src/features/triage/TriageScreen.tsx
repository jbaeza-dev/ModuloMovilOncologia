import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Linking, View } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  ChoiceChip,
  FeedbackBanner,
  InfoCard,
  SectionTitle,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { validateVitalInput } from '../../data/local/validation';
import { useLocalData } from '../../providers/LocalDataProvider';
import { getCivilPartsInTimeZone } from '../../services/reminders/reminder-status';
import { isDemoMode } from '../../utils/environment';
import {
  proposal,
  questions,
  type Answer,
  type Informant,
  type QuestionId,
  type TemperatureSite,
} from './triage-definition';
import { evaluateOrientation, type OrientationInput, type ResponseOrigin } from './triage-engine';
import { createOrientationRepository } from './triage-repository';

export function syntheticReviewEnabled(): boolean {
  return isDemoMode() && process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW === 'true';
}
type HistoryItem = {
  id: string;
  created_at: string;
  definition_version: string;
  snapshot_json: string;
};

function storedMessage(item: HistoryItem): string {
  try {
    const value: unknown = JSON.parse(item.snapshot_json);
    if (value && typeof value === 'object' && 'result' in value) {
      const result = value.result;
      if (
        result &&
        typeof result === 'object' &&
        'message' in result &&
        typeof result.message === 'string'
      )
        return result.message;
    }
  } catch {
    /* Preserve the record rather than recomputing it with today's definition. */
  }
  return 'El mensaje conservado requiere revisión; no se ha recalculado la evaluación.';
}

export function TriageScreen() {
  const { database, patientId, clinicalStore, runSave, isClosing } = useLocalData();
  const synthetic = syntheticReviewEnabled();
  const epoch = `${patientId}:${clinicalStore?.scope.environment ?? ''}`;
  const [formEpoch, setFormEpoch] = useState(epoch);
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
  useEffect(() => {
    activeEpoch.current = epoch;
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
    setFormEpoch(epoch);
    return () => {
      activeEpoch.current = 'closed';
    };
  }, [epoch]);

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
  const result = useMemo(
    () => evaluateOrientation(input, synthetic ? 'synthetic' : 'clinical'),
    [input, synthetic],
  );
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
    if (!synthetic || !repository || busy || isClosing || savingEpoch.current === epoch)
      return false;
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
        setError('No se pudo guardar esta evaluación de prueba. La orientación permanece visible.');
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
      if (activeEpoch.current === capturedEpoch) setHistory(items);
    } catch {
      if (activeEpoch.current === capturedEpoch)
        setError('No se pudo consultar el historial. Se conservan las evaluaciones.');
    } finally {
      if (activeEpoch.current === capturedEpoch) setBusy(false);
    }
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
    <FeedbackBanner
      variant="warning"
      title="Simulación con datos ficticios"
      message="Propuesta v0.5 pendiente de revisión clínica. Este recorrido sirve para evaluar el funcionamiento; no entrega indicaciones para pacientes reales."
    />
  );
  const resultCard = result.outcome ? (
    <InfoCard>
      <SectionTitle>Resultado de simulación: {result.outcome}</SectionTitle>
      <BodyText>{result.message}</BodyText>
      <BodyText>
        {result.complete
          ? 'Evaluación de prueba completa.'
          : 'Registro de prueba incompleto; se conservan las señales conocidas.'}
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
            label="Salir y conservar evaluación de prueba"
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
        label={
          saved
            ? 'Evaluación de prueba guardada'
            : busy
              ? 'Guardando…'
              : 'Guardar evaluación de prueba'
        }
        disabled={busy || saved || !repository}
        onPress={() => void save()}
      />
    </InfoCard>
  ) : null;
  if (formEpoch !== epoch)
    return (
      <Screen title="Orientación de síntomas">
        <BodyText>Preparando tu contexto…</BodyText>
      </Screen>
    );
  if (!synthetic)
    return (
      <Screen title="Orientación de síntomas" mascotPose="resumen">
        <InfoCard>
          <SectionTitle>Orientación en preparación</SectionTitle>
          <BodyText>
            Este apartado está pendiente de revisión clínica. Puedes seguir registrando tus signos y
            completar tu seguimiento habitual.
          </BodyText>
          <BodyText>
            Para consultar sobre tus molestias, utiliza los canales que te indicó tu equipo
            tratante.
          </BodyText>
        </InfoCard>
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
              label="Volver a mis respuestas de prueba"
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
              label={
                alarm
                  ? 'Ver y completar datos de prueba (opcional)'
                  : 'Volver a mis respuestas de prueba'
              }
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
              label="Volver a la orientación urgente de prueba"
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
                selected={answers[question.id] === value}
                disabled={busy}
                onPress={() => answer(question.id, value)}
              />
            ))}
          </View>
        </InfoCard>
      ))}
      <VisualField
        label="Dolor ENA de prueba (0 a 10)"
        value={pain}
        keyboardType="number-pad"
        maxLength={3}
        editable={!busy}
        onChangeText={(value) => {
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
        maxLength={6}
        editable={!busy}
        onChangeText={(value) => {
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
      <VisualField
        label="Dispositivo de temperatura (opcional)"
        value={device}
        maxLength={80}
        editable={!busy}
        onChangeText={(value) => {
          edited();
          setDevice(value);
        }}
      />
      <BodyText>
        Los umbrales clínicos por sitio y su uso con el tratamiento siguen pendientes de resolución.
        No se aplica una conversión automática de temperatura.
      </BodyText>
      <VisualField
        label="Última quimioterapia administrada (AAAA-MM-DD, opcional)"
        value={treatmentDate}
        maxLength={10}
        editable={!busy}
        onChangeText={(value) => {
          edited();
          setTreatmentDate(value);
        }}
        helperText="Anota una administración real, no una cita futura. Puedes dejarla desconocida."
        errorText={
          treatmentDate && !dateValid
            ? 'Revisa la fecha: usa AAAA-MM-DD y una administración que ya haya ocurrido.'
            : undefined
        }
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
        label="Ver orientación de prueba"
        disabled={busy}
        onPress={() => {
          Keyboard.dismiss();
          setShowResult(true);
        }}
      />
      {contacts}
      <VisualButton
        label="Consultar historial de pruebas"
        disabled={busy || !repository}
        secondary
        onPress={() => void loadHistory()}
      />
      {history.map((item) => (
        <InfoCard key={item.id}>
          <BodyText>Evaluación de simulación del {item.created_at}</BodyText>
          <BodyText>Edición conservada: {item.definition_version}</BodyText>
          <BodyText>{storedMessage(item)}</BodyText>
        </InfoCard>
      ))}
      {error ? (
        <FeedbackBanner variant="error" title="No se pudo completar la acción" message={error} />
      ) : null}
      <BodyText>
        Edición de prueba: {proposal.version}. Reglas clínicas pendientes de aprobación.
      </BodyText>
    </Screen>
  );
}
