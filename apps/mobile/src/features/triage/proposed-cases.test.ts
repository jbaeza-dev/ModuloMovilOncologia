import { describe, expect, it } from 'vitest';
import { proposal, questions, type Orientation } from './triage-definition';
import { evaluateOrientation, type OrientationInput } from './triage-engine';
import type { PlanAssessment } from './palliative-plan';

/** Verbatim review scenarios/expectations from v0.5, not an independently approved corpus.
 * Assertions below cover ONLY the local engine's conservative technical invariants.
 * Calls, contact availability, signatures, storage and clinical thresholds require their
 * separate tests/review; an engine assertion never proves those operational actions. */
const proposedCases = [
  {
    id: 'C01',
    scenario: 'Dificultad respiratoria importante ahora; sin termómetro ni presión',
    clinicalExpectationProposed: 'A1 inmediato, sin esperar más datos',
    clinicalApproval: false,
  },
  {
    id: 'C02',
    scenario:
      'Temperatura 38,5 °C, con sitio consignado; paciente alerta, presión normal, sin otros síntomas',
    clinicalExpectationProposed:
      'A2 candidato a ratificar según sitio; no exigir qSOFA ni sensación subjetiva de gravedad',
    clinicalApproval: false,
  },
  {
    id: 'C03',
    scenario: 'Tiritones intensos y deterioro nuevo; temperatura normal tras antitérmico',
    clinicalExpectationProposed: 'A2',
    clinicalApproval: false,
  },
  {
    id: 'C04',
    scenario:
      'Temperatura axilar 37,6 °C y deterioro general nuevo importante durante quimioterapia',
    clinicalExpectationProposed:
      'A2 por la señal clínica propuesta de deterioro; no afirmar que 37,6 por sí sola es un umbral aprobado ni exigir otra toma antes de solicitar ayuda',
    clinicalApproval: false,
  },
  {
    id: 'C05',
    scenario: 'Temperatura 37,6 °C, sin molestias, pauta individual ordena contactar desde 37,5',
    clinicalExpectationProposed:
      'Respetar contacto indicado por la pauta; nunca C contra una instrucción más protectora',
    clinicalApproval: false,
  },
  {
    id: 'C06',
    scenario:
      'Paciente en paliativos con falta de aire importante actual, sin un plan domiciliario previamente verificado que cubra esa crisis',
    clinicalExpectationProposed:
      'A1 y vía general de ayuda inmediata, comunicar contexto/preferencias; no reducir urgencia por pertenecer a paliativos',
    clinicalApproval: false,
  },
  {
    id: 'C07',
    scenario: 'Vómitos que impiden retener agua/medicación; poca orina',
    clinicalExpectationProposed: 'A2',
    clinicalApproval: false,
  },
  {
    id: 'C08',
    scenario: 'Dolor de espalda y nueva pérdida de fuerza/control de esfínteres',
    clinicalExpectationProposed:
      'A2 urgente; A1 si existe déficit neurológico súbito de emergencia',
    clinicalApproval: false,
  },
  {
    id: 'C09',
    scenario: 'ENA 8 sin otras alarmas, sin control con la pauta',
    clinicalExpectationProposed:
      'B con contacto sin demora y circuito de escalamiento revisado; no indicar dosis de rescate desde la app',
    clinicalApproval: false,
  },
  {
    id: 'C10',
    scenario: 'ENA 2 en pecho con disnea nueva',
    clinicalExpectationProposed: 'A1; la cifra baja no neutraliza el contexto',
    clinicalApproval: false,
  },
  {
    id: 'C11',
    scenario:
      'Náusea leve prevista, controlada con pauta; ingesta conservada y preguntas críticas negativas',
    clinicalExpectationProposed: 'C',
    clinicalApproval: false,
  },
  {
    id: 'C12',
    scenario: 'Todo sin responder, signos ausentes',
    clinicalExpectationProposed: 'D, nunca C',
    clinicalApproval: false,
  },
  {
    id: 'C13',
    scenario: 'Sin tensiómetro/saturómetro, síntomas leves controlados y chequeo crítico completo',
    clinicalExpectationProposed:
      'C posible; falta de dispositivos por sí sola no implica urgencias',
    clinicalApproval: false,
  },
  {
    id: 'C14',
    scenario: 'Temperatura de ayer normal; fiebre/malestar referido ahora y no se puede medir',
    clinicalExpectationProposed:
      'A2 según síntomas actuales; no usar la medición antigua para tranquilizar',
    clinicalApproval: false,
  },
  {
    id: 'C15',
    scenario: 'Una pierna recién hinchada/dolorosa; sin falta de aire',
    clinicalExpectationProposed: 'A2; con disnea/pecho pasa a A1',
    clinicalApproval: false,
  },
  {
    id: 'C16',
    scenario: 'ENA 5 que altera sueño y se controla insuficientemente',
    clinicalExpectationProposed: 'B',
    clinicalApproval: false,
  },
  {
    id: 'C17',
    scenario: 'Hormigueo conocido leve estable; sin pérdida nueva de función ni otras alarmas',
    clinicalExpectationProposed:
      'C solo con pauta y todos sus criterios; no etiquetar compresión medular',
    clinicalApproval: false,
  },
  {
    id: 'C18',
    scenario: 'Sangre en vómito; otra medición normal',
    clinicalExpectationProposed: 'A2 como mínimo; A1 si sangrado abundante/desmayo/deterioro',
    clinicalApproval: false,
  },
  {
    id: 'C19',
    scenario: 'Varias alarmas concurrentes',
    clinicalExpectationProposed:
      'Mostrar la de mayor urgencia y conservar todas las señales; no perder acciones por cortocircuito',
    clinicalApproval: false,
  },
  {
    id: 'C20',
    scenario:
      'Síntoma no contemplado o respuesta contradictoria sin alarma suficiente identificada',
    clinicalExpectationProposed: 'D con vía de consulta, nunca C por descarte',
    clinicalApproval: false,
  },
  {
    id: 'C21',
    scenario:
      'Crisis respiratoria importante; plan paliativo previamente verificado que la cubre, disponible y con vía domiciliaria y contingencia pactadas',
    clinicalExpectationProposed:
      'Conservar A1; mostrar vía/instrucciones del plan y ayuda inmediata acordada. No imponer un rescate genérico previo ni una hospitalización automática',
    clinicalApproval: false,
  },
  {
    id: 'C22',
    scenario:
      'Persona declara «sí tengo plan», pero no está verificado, no lo encuentra o el síntoma no está cubierto',
    clinicalExpectationProposed:
      'La declaración no rebaja A1/A2 ni bloquea la ayuda para verificar documentos; comunicar preferencias y obtener ayuda urgente',
    clinicalApproval: false,
  },
  {
    id: 'C23',
    scenario:
      'Plan individual aplicable, pero no se logra la ayuda prevista, faltan los medios o fracasa el manejo acordado',
    clinicalExpectationProposed:
      'Seguir contingencia; pedir ayuda urgente comunicando el plan. No repetir rescates ni prolongar espera por decisión de la app',
    clinicalApproval: false,
  },
  {
    id: 'C24',
    scenario: 'Criterio B de noche o en fin de semana; contacto habitual cerrado',
    clinicalExpectationProposed:
      'Mostrar alternativa disponible; no esperar al día hábil si aumenta/no se controla. Revisor fija la conducta concreta por síntoma',
    clinicalApproval: false,
  },
  {
    id: 'C25',
    scenario:
      'Criterio B persistente sin control, sin empeoramiento claro; no responde el canal habitual',
    clinicalExpectationProposed:
      'No interpretar «no empeora» como autorización para esperar indefinidamente; aplicar contingencia y valoración urgente propuestas',
    clinicalApproval: false,
  },
  {
    id: 'C26',
    scenario: 'Contacto de policlínico guardado sin horario o vigencia confirmados',
    clinicalExpectationProposed:
      'Mostrar horario no confirmado y alternativa; no afirmar disponibilidad ni recepción de avisos',
    clinicalApproval: false,
  },
  {
    id: 'C27',
    scenario:
      'Lectura axilar 37,5–37,9 °C sin síntomas, sin pauta individual que resuelva ese rango',
    clinicalExpectationProposed:
      'Frontera pendiente de decisión clínica; no fabricar temperatura oral ni declarar C usando un umbral no validado',
    clinicalApproval: false,
  },
  {
    id: 'C28',
    scenario: 'Lectura con sitio desconocido o técnica dudosa, con tiritones/deterioro importantes',
    clinicalExpectationProposed:
      'Conservar alarma por síntomas; solicitar valoración sin exigir medición «corregida» o repetida',
    clinicalApproval: false,
  },
  {
    id: 'C29',
    scenario: 'A1 con botón 131 pulsado; el dispositivo solo abrió el marcador',
    clinicalExpectationProposed:
      'Registrar únicamente la acción observable de apertura si procede; no llamada efectiva ni atención recibida',
    clinicalApproval: false,
  },
  {
    id: 'C30',
    scenario: 'A1 sin Internet; teléfono no puede efectuar una llamada',
    clinicalExpectationProposed:
      'Mostrar orientación local y número/alternativa de pedir ayuda; no depender del backend ni simular una comunicación',
    clinicalApproval: false,
  },
  {
    id: 'C31',
    scenario: 'Atención urgente; carnet de tratamiento no está a mano',
    clinicalExpectationProposed: 'Obtener ayuda sin demorarla para buscar documentos',
    clinicalApproval: false,
  },
  {
    id: 'C32',
    scenario: 'Plan paliativo o contactos no pueden descargarse durante la crisis',
    clinicalExpectationProposed:
      'Mostrar la información local verificada disponible y su limitación; no esperar red para emitir A1/A2 ni inventar un plan',
    clinicalApproval: false,
  },
  {
    id: 'C33',
    scenario: 'QR/constancia alterados o clave emisora no confiable',
    clinicalExpectationProposed:
      'No declarar plan verificado; conservar el antecedente y explicar el fallo, sin bloquear ayuda ni inventar una aprobación',
    clinicalApproval: false,
  },
  {
    id: 'C34',
    scenario: 'Constancia válida para otro paciente, entorno o contenido',
    clinicalExpectationProposed:
      'Rechazar la asociación y conservar el plan previo; no copiar datos de otra cuenta ni habilitar una vía personalizada',
    clinicalApproval: false,
  },
  {
    id: 'C35',
    scenario: 'Paciente intenta editar instrucciones de un plan verificado',
    clinicalExpectationProposed:
      'No sobrescribir la versión; permitir comunicar cambios y solicitar revisión. Verificar integridad y registrar el hecho conforme al diseño, sin prometer resistencia absoluta a manipulación',
    clinicalApproval: false,
  },
  {
    id: 'C36',
    scenario:
      'Persona tiene un plan clínico escrito, pero todavía no está dado de alta digitalmente',
    clinicalExpectationProposed:
      'Distinguir no registrado/no verificado de inválido; comunicar plan y solicitar ayuda sin exigir QR/PIN ni ordenar ignorar indicaciones profesionales',
    clinicalApproval: false,
  },
  {
    id: 'C37',
    scenario: 'Cuidador informa que el paciente no responde y no conoce una ENA',
    clinicalExpectationProposed:
      'A1 inmediato por la alarma propuesta; conservar informante cuidador y ausencia de ENA. No pedir un número para acceder a la ayuda',
    clinicalApproval: false,
  },
  {
    id: 'C38',
    scenario: 'Paciente responde y un familiar únicamente lee/toca la pantalla',
    clinicalExpectationProposed:
      'Registrar informante paciente y ayuda de uso, sin atribuir los síntomas al familiar',
    clinicalApproval: false,
  },
  {
    id: 'C39',
    scenario: 'Comienza respondiendo el paciente y luego describe síntomas un cuidador',
    clinicalExpectationProposed:
      'Conservar origen por respuesta/bloque y el cambio, sin atribuir retrospectivamente todo al último informante',
    clinicalApproval: false,
  },
  {
    id: 'C40',
    scenario:
      'Axilar 37,7 °C sin otras alarmas; última administración desconocida o solo hay una cita prevista',
    clinicalExpectationProposed:
      'Contexto de tratamiento desconocido; no inferir nadir ni bajo riesgo ni autorizar esperar dos horas. Conducta clínica exacta pendiente de la mesa',
    clinicalApproval: false,
  },
  {
    id: 'C41',
    scenario:
      'Axilar 37,7 °C sin otras alarmas, día 8 frente a día 16; no hay ventana individual aprobada',
    clinicalExpectationProposed:
      'Ninguna fecha por sí sola define neutropenia o tranquilidad. Revisor debe resolver los dos casos; no introducir regla automática 7–14',
    clinicalApproval: false,
  },
  {
    id: 'C42',
    scenario: 'D persiste después de una aclaración o la persona responde «no sé»',
    clinicalExpectationProposed:
      'Salida asistida visible, datos conservados e incompletos; no volver obligatoriamente al mismo formulario ni mostrar C',
    clinicalApproval: false,
  },
  {
    id: 'C43',
    scenario: 'Persona no puede leer o manejar la aclaración de D',
    clinicalExpectationProposed:
      'Permitir pedir orientación o salir conservando datos desde la primera pantalla; no exigir completar el intento de aclaración',
    clinicalApproval: false,
  },
  {
    id: 'C44',
    scenario:
      'Se aprobó para un caso concreto un recontrol térmico, pero aparece una alarma antes del plazo',
    clinicalExpectationProposed:
      'Interrumpir espera y mostrar la acción urgente correspondiente; no exigir que venza el temporizador ni usarlo como vigilancia profesional',
    clinicalApproval: false,
  },
] as const;
const scope = { patientId: 'synthetic-a', environment: 'test' };
const plan: PlanAssessment = {
  state: 'VERIFICADO_LOCAL',
  applicable: true,
  reason: 'individual-plan-applicable',
  planId: 'synthetic-plan',
  version: 1,
  contentHash: 'a'.repeat(64),
  trustCheckedAt: '2026-11-02T10:00:00Z',
  patientId: scope.patientId,
  environment: scope.environment,
  coveredSignals: ['A1-RESP'],
  instructions: 'Instrucción individual sintética, no pauta médica.',
  contingency: 'Contingencia sintética, sin fármacos ni dosis.',
  contact: 'Contacto sintético',
};
function scenario(number: number): {
  input: OrientationInput;
  expected: Orientation;
  checkedPlan?: PlanAssessment;
} {
  const input: OrientationInput = {
    answers: Object.fromEntries(questions.map((q) => [q.id, q.group === 'C' ? 'yes' : 'no'])),
    informant: 'PACIENTE',
    pain: 0,
    painSource: 'self',
  };
  let expected: Orientation = 'C',
    checkedPlan: PlanAssessment | undefined;
  const respiratory = [1, 6, 19, 21, 22, 23, 29, 30, 31, 32, 33, 34, 35, 36, 44];
  if (respiratory.includes(number)) {
    input.answers['A1-RESP'] = 'yes';
    expected = 'A1';
  }
  if ([3, 4, 14, 28].includes(number)) {
    input.answers['A2-INFECCION'] = 'yes';
    expected = 'A2';
  }
  if (number === 7) {
    input.answers['A2-INGESTA'] = 'yes';
    expected = 'A2';
  }
  if (number === 8) {
    input.answers['A2-MEDULA'] = 'yes';
    expected = 'A2';
  }
  if (number === 9) {
    input.pain = 8;
    input.answers['B-PAIN-CONTEXT'] = 'yes';
    expected = 'B';
  }
  if (number === 10) {
    input.pain = 2;
    input.answers['A1-TORAX'] = 'yes';
    expected = 'A1';
  }
  if ([12, 42, 43].includes(number)) {
    input.answers = {};
    input.pain = null;
    input.informant = null;
    expected = 'D';
  }
  if (number === 15) {
    input.answers['A2-TROMBO'] = 'yes';
    expected = 'A2';
  }
  if (number === 16) {
    input.pain = 5;
    input.answers['B-PAIN-CONTEXT'] = 'yes';
    expected = 'B';
  }
  if (number === 18) {
    input.answers['A2-DIGESTIVO'] = 'yes';
    expected = 'A2';
  }
  if (number === 19) {
    input.answers['A2-INGESTA'] = 'yes';
    input.answers['B-SYMPTOMS'] = 'yes';
  }
  if (number === 20) {
    input.contradictions = ['unresolved-symptom'];
    expected = 'D';
  }
  if (number === 21) checkedPlan = { ...plan };
  if ([22, 36].includes(number)) input.palliativePlanDeclared = 'yes';
  if (number === 23) checkedPlan = { ...plan, applicable: false, reason: 'contingency-required' };
  if ([24, 25, 26].includes(number)) {
    input.answers['B-SYMPTOMS'] = 'yes';
    expected = 'B';
  }
  if ([2, 5, 27, 40, 41].includes(number)) {
    input.temperature = {
      value: number === 2 ? 38.5 : number === 27 ? 37.6 : 37.7,
      site: 'axillary',
      measuredAt: '2026-11-02T10:00:00Z',
    };
    // No approved site-specific policy or individual temperature-path integration exists.
    // Preserve the unresolved decision rather than invent A2/B/C from the proposed text.
    expected = 'D';
  }
  if (number === 4)
    input.temperature = { value: 37.6, site: 'axillary', measuredAt: '2026-11-02T10:00:00Z' };
  if (number === 28)
    input.temperature = { value: 36.5, site: 'unknown', measuredAt: '2026-11-02T10:00:00Z' };
  if (number === 33)
    checkedPlan = {
      ...plan,
      state: 'DECLARADO_NO_VERIFICADO',
      applicable: false,
      reason: 'invalid-provenance',
    };
  if (number === 34) checkedPlan = { ...plan, patientId: 'synthetic-b' };
  if (number === 35) checkedPlan = { ...plan }; // Engine reads a resolved immutable version; edit control is repository-tested separately.
  if (number === 37) {
    input.informant = 'CUIDADOR_FAMILIAR';
    input.pain = null;
    input.painSource = 'unavailable';
    input.answers['A1-CONCIENCIA'] = 'yes';
    expected = 'A1';
  }
  if (number === 38) input.assisted = true;
  if (number === 39) {
    input.informant = 'CUIDADOR_FAMILIAR';
    input.answers['B-SYMPTOMS'] = 'yes';
    expected = 'B';
    input.origins = {
      'A1-RESP': { role: 'PACIENTE', source: 'self', at: '2026-11-02T09:59:00Z' },
      'B-SYMPTOMS': { role: 'CUIDADOR_FAMILIAR', source: 'observed', at: '2026-11-02T10:00:00Z' },
    };
  }
  if (number === 40)
    input.treatment = { lastAdministration: null, precision: 'unknown', source: 'unknown' };
  if (number === 41)
    input.treatment = { lastAdministration: '2026-10-25', precision: 'exact', source: 'patient' };
  if (number === 42)
    input.clarification = { attempted: true, question: 'critical-symptoms', answer: 'unknown' };
  return { input, expected, checkedPlan };
}
describe('C01–C44 v0.5: invariantes técnicos; aprobación clínica y operación separadas', () => {
  it.each(proposedCases)('$id — $scenario', (row) => {
    const number = Number(row.id.slice(1));
    const { input, expected, checkedPlan } = scenario(number);
    const before = JSON.stringify(input);
    const result = evaluateOrientation(
      input,
      'synthetic',
      proposal,
      checkedPlan ? { scope, plan: checkedPlan } : undefined,
    );
    expect(result.outcome).toBe(expected);
    expect(JSON.stringify(input)).toBe(before);
    expect(row.clinicalApproval).toBe(false);
    expect(evaluateOrientation(input).availability).toBe('disabled');
    if ([2, 5, 27, 40, 41].includes(number))
      expect(result.pendingResolutions).toEqual(expect.arrayContaining(['R06', 'R07']));
    if (number === 19)
      expect(result.matchedRules).toEqual(
        expect.arrayContaining(['A1-RESP', 'A2-INGESTA', 'B-SYMPTOMS']),
      );
    if ([21, 35].includes(number)) expect(result.route).toBe('individual-plan');
    if ([6, 22, 23, 32, 33, 34, 36].includes(number)) expect(result.route).toBe('general');
    if (number === 37) expect(result.missing).toContain('pain');
    if (number === 38) expect(input.informant).toBe('PACIENTE');
    if (number === 39) expect(input.origins?.['A1-RESP']?.role).toBe('PACIENTE');
    if (number === 41) {
      const later = evaluateOrientation(
        {
          ...input,
          treatment: { lastAdministration: '2026-10-17', precision: 'exact', source: 'patient' },
        },
        'synthetic',
      );
      expect(later.outcome).toBe('D');
      expect(later.pendingResolutions).toEqual(result.pendingResolutions);
    }
    if (number === 42) expect(result.clarificationOffered).toBe(false);
    if (number === 43) {
      expect(result.clarificationOffered).toBe(true);
      expect(result.message).toContain('600 360 7777');
    }
  });
});
