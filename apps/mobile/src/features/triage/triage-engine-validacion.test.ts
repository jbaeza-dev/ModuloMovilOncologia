import { describe, expect, it } from 'vitest';
import type { PlanAssessment } from './palliative-plan';
import {
  evaluateOrientation,
  validateOrientationDefinition,
  type OrientationInput,
} from './triage-engine';
import { proposal, questions, type OrientationDefinition } from './triage-definition';

const resoluciones = Array.from({ length: 18 }, (_, n) => 'R' + String(n + 1).padStart(2, '0'));
const aprobada: OrientationDefinition = {
  ...proposal,
  status: 'approved',
  approval: {
    reviewer: 'Revisor sintético',
    actReference: 'Acta sintética',
    reviewedAt: '2026-11-01T00:00:00Z',
    resolutions: resoluciones,
  } as OrientationDefinition['approval'],
  temperaturePolicies: [
    { site: 'axillary', high: 38, highInclusive: true, low: 35, lowInclusive: false },
    { site: 'oral', high: 38.3, highInclusive: false, low: 35, lowInclusive: true },
  ] as OrientationDefinition['temperaturePolicies'],
};

/** Todas las preguntas A/B en «no» y las C en «sí»: escenario base sin alarmas. */
function sinAlarmas(): OrientationInput['answers'] {
  return Object.fromEntries(questions.map((q) => [q.id, q.group === 'C' ? 'yes' : 'no']));
}
const base = (over: Partial<OrientationInput> = {}): OrientationInput => ({
  answers: sinAlarmas(),
  informant: 'PACIENTE',
  pain: 1,
  ...over,
});

describe('validateOrientationDefinition', () => {
  it('acepta la propuesta en borrador y una edición aprobada completa', () => {
    expect(() => validateOrientationDefinition(proposal)).not.toThrow();
    expect(() => validateOrientationDefinition(aprobada)).not.toThrow();
  });

  it.each([
    ['sin identificador', { ...proposal, id: '' }],
    ['sin versión', { ...proposal, version: '' }],
    ['hash inválido', { ...proposal, sourceHash: 'abc' }],
  ])('rechaza la identidad de la definición %s', (_caso, def) => {
    expect(() => validateOrientationDefinition(def as OrientationDefinition)).toThrow(
      'La definición de orientación es inválida.',
    );
  });

  it.each([
    ['estado desconocido', { ...proposal, status: 'otro' }],
    ['mensaje vacío', { ...proposal, messages: { ...proposal.messages, B: '  ' } }],
  ])('rechaza mensajes o estado inutilizables: %s', (_caso, def) => {
    expect(() => validateOrientationDefinition(def as unknown as OrientationDefinition)).toThrow(
      'La definición no contiene mensajes utilizables.',
    );
  });

  it.each([
    ['sin aprobación', { ...aprobada, approval: null }],
    ['sin revisor', { ...aprobada, approval: { ...aprobada.approval!, reviewer: ' ' } }],
    ['sin acta', { ...aprobada, approval: { ...aprobada.approval!, actReference: '' } }],
    ['fecha inválida', { ...aprobada, approval: { ...aprobada.approval!, reviewedAt: 'x' } }],
    [
      'resoluciones incompletas',
      { ...aprobada, approval: { ...aprobada.approval!, resolutions: ['R01'] } },
    ],
  ])('rechaza una edición aprobada %s', (_caso, def) => {
    expect(() => validateOrientationDefinition(def as OrientationDefinition)).toThrow(
      'La edición no tiene aprobación operativa completa.',
    );
  });

  it.each([
    [
      'sitio desconocido',
      { site: 'rectal', high: 38, highInclusive: true, low: 35, lowInclusive: true },
    ],
    [
      'umbral no finito',
      { site: 'oral', high: Infinity, highInclusive: true, low: 35, lowInclusive: true },
    ],
    [
      'bajo no finito',
      { site: 'oral', high: 38, highInclusive: true, low: NaN, lowInclusive: true },
    ],
    [
      'bajo mayor que alto',
      { site: 'oral', high: 35, highInclusive: true, low: 38, lowInclusive: true },
    ],
    [
      'inclusión no lógica',
      { site: 'oral', high: 38, highInclusive: 'si', low: 35, lowInclusive: true },
    ],
    [
      'inclusión baja no lógica',
      { site: 'oral', high: 38, highInclusive: true, low: 35, lowInclusive: 1 },
    ],
  ])('rechaza una política de temperatura con %s', (_caso, politica) => {
    expect(() =>
      validateOrientationDefinition({
        ...proposal,
        temperaturePolicies: [politica],
      } as unknown as OrientationDefinition),
    ).toThrow('La política de temperatura es inválida.');
  });

  it('rechaza sitios de temperatura repetidos', () => {
    const p = aprobada.temperaturePolicies[0]!;
    expect(() =>
      validateOrientationDefinition({ ...proposal, temperaturePolicies: [p, p] }),
    ).toThrow('La política de temperatura es inválida.');
  });
});

describe('evaluateOrientation: entradas y disponibilidad', () => {
  it('en modo clínico con edición en borrador queda deshabilitada', () => {
    const r = evaluateOrientation(base(), 'clinical', proposal);
    expect(r.availability).toBe('disabled');
    expect(r.outcome).toBeNull();
  });

  it('en modo clínico con edición aprobada evalúa', () => {
    expect(evaluateOrientation(base(), 'clinical', aprobada).availability).toBe('evaluated');
  });

  it('rechaza respuestas ajenas, valores inválidos e informantes desconocidos', () => {
    expect(() =>
      evaluateOrientation(
        base({ answers: { 'X-1': 'yes' } as OrientationInput['answers'] }),
        'synthetic',
      ),
    ).toThrow('Respuesta ajena a la edición de orientación.');
    expect(() =>
      evaluateOrientation(
        base({ answers: { 'A1-RESP': 'quizas' } as unknown as OrientationInput['answers'] }),
        'synthetic',
      ),
    ).toThrow('Respuesta ajena a la edición de orientación.');
    expect(() =>
      evaluateOrientation(
        base({ informant: 'VECINO' as OrientationInput['informant'] }),
        'synthetic',
      ),
    ).toThrow('Rol de informante inválido.');
  });

  it('rechaza antecedentes de señal ajenos o no urgentes', () => {
    expect(() =>
      evaluateOrientation(
        base({ positiveSignals: ['C-KNOWN'] as OrientationInput['positiveSignals'] }),
        'synthetic',
      ),
    ).toThrow('Antecedente de señal ajeno a la edición.');
  });

  it('un antecedente positivo no confirmado lleva al nivel con contradicción pendiente', () => {
    const r = evaluateOrientation(base({ positiveSignals: ['A2-INFECCION'] }), 'synthetic');
    expect(r.outcome).toBe('A2');
    expect(r.missing).toContain('contradiction:A2-INFECCION');
  });
});

describe('evaluateOrientation: niveles y datos faltantes', () => {
  it('sin alarmas, condiciones C y dolor bajo entrega nivel C completo', () => {
    const r = evaluateOrientation(base(), 'synthetic');
    expect(r).toMatchObject({ outcome: 'C', complete: true, clarificationOffered: false });
  });

  it('dolor 7 o mayor entrega nivel B', () => {
    expect(evaluateOrientation(base({ pain: 7 }), 'synthetic').outcome).toBe('B');
  });

  it('dolor 4 con contexto de dolor entrega nivel B', () => {
    const answers = { ...sinAlarmas(), 'B-PAIN-CONTEXT': 'no' as const };
    expect(evaluateOrientation(base({ pain: 4, answers }), 'synthetic').outcome).toBe('D');
    expect(
      evaluateOrientation(
        base({ pain: 4, answers: { ...answers, 'B-PAIN-CONTEXT': 'yes' } }),
        'synthetic',
      ).outcome,
    ).toBe('B');
  });

  it('dolor no válido, informante ausente, contradicciones y signos sin interpretar llevan a D', () => {
    const r = evaluateOrientation(
      base({
        pain: 11,
        informant: null,
        contradictions: ['C-KNOWN'],
        unresolvedVitals: true,
        clarification: { attempted: true, question: 'q', answer: 'unknown' },
      }),
      'synthetic',
    );
    expect(r.outcome).toBe('D');
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'pain',
        'informant',
        'contradiction:C-KNOWN',
        'uninterpreted-vitals',
      ]),
    );
    expect(r.pendingResolutions).toContain('R10');
    expect(r.clarificationOffered).toBe(false);
  });

  it('dolor informado como no disponible no se usa', () => {
    expect(evaluateOrientation(base({ painSource: 'unavailable' }), 'synthetic').missing).toContain(
      'pain',
    );
  });

  it('sin condiciones C cumplidas o con dolor mayor que 3 entrega D con los faltantes', () => {
    const answers = { ...sinAlarmas(), 'C-KNOWN': 'no' as const };
    const r = evaluateOrientation(base({ answers }), 'synthetic');
    expect(r.outcome).toBe('D');
    expect(r.missing).toContain('C-KNOWN');
    expect(r.clarificationOffered).toBe(true);
    const r2 = evaluateOrientation(base({ pain: 5 }), 'synthetic');
    expect(r2.missing).toContain('pain-context');
  });

  it.each([
    ['fuera de rango', 50],
    ['bajo el rango', 20],
    ['con más de un decimal', 37.25],
    ['no finita', NaN],
  ])('una temperatura %s se marca inválida', (_caso, value) => {
    const r = evaluateOrientation(
      base({ temperature: { value, site: 'axillary', measuredAt: '2026-11-05T10:00:00Z' } }),
      'synthetic',
      aprobada,
    );
    expect(r.missing).toContain('temperature-invalid');
  });

  it('una temperatura con fecha inválida se marca inválida', () => {
    const r = evaluateOrientation(
      base({ temperature: { value: 37, site: 'axillary', measuredAt: 'x' } }),
      'synthetic',
      aprobada,
    );
    expect(r.missing).toContain('temperature-invalid');
  });

  it('sin política para el sitio deja resoluciones pendientes', () => {
    const r = evaluateOrientation(
      base({ temperature: { value: 37, site: 'tympanic', measuredAt: '2026-11-05T10:00:00Z' } }),
      'synthetic',
      aprobada,
    );
    expect(r.pendingResolutions).toEqual(expect.arrayContaining(['R06', 'R07']));
    expect(r.missing).toContain('temperature-policy');
  });

  it.each([
    ['axillary', 38, 'A2'],
    ['axillary', 35, 'C'],
    ['axillary', 34.9, 'A2'],
    ['oral', 38.3, 'C'],
    ['oral', 38.4, 'A2'],
    ['oral', 35, 'A2'],
  ] as const)('aplica límites inclusivos y exclusivos (%s %s → %s)', (site, value, nivel) => {
    const r = evaluateOrientation(
      base({ temperature: { value, site, measuredAt: '2026-11-05T10:00:00Z' } }),
      'synthetic',
      aprobada,
    );
    expect(r.outcome).toBe(nivel);
  });
});

describe('evaluateOrientation: plan individual verificado', () => {
  const scope = { patientId: 'patient-a', environment: 'synthetic' };
  const plan: PlanAssessment = {
    state: 'VERIFICADO_LOCAL',
    applicable: true,
    reason: 'individual-plan-applicable',
    planId: 'plan-1',
    version: 1,
    contentHash: 'a'.repeat(64),
    trustCheckedAt: '2026-11-01T00:00:00Z',
    patientId: 'patient-a',
    environment: 'synthetic',
    coveredSignals: ['A1-RESP'],
    instructions: 'Instrucciones sintéticas.',
    contingency: 'Contingencia sintética.',
    contact: 'canal',
  };
  const urgente = () => base({ answers: { ...sinAlarmas(), 'A1-RESP': 'yes' } });

  it('aplica el plan cuando cubre todas las señales y el contexto coincide', () => {
    const r = evaluateOrientation(urgente(), 'synthetic', proposal, { scope, plan });
    expect(r.route).toBe('individual-plan');
    expect(r.planApplied).toEqual({
      id: 'plan-1',
      version: 1,
      hash: 'a'.repeat(64),
      trustCheckedAt: plan.trustCheckedAt,
    });
    expect(r.message).toContain('Contingencia sintética.');
  });

  it('no aplica el plan si no cubre la señal o el contexto es distinto', () => {
    const r = evaluateOrientation(urgente(), 'synthetic', proposal, {
      scope: { ...scope, patientId: 'otro' },
      plan,
    });
    expect(r.route).toBe('general');
    expect(r.planNotAppliedReason).toBe('not-covered-or-context-mismatch');
  });

  it('conserva el motivo del plan cuando no está verificado', () => {
    const r = evaluateOrientation(urgente(), 'synthetic', proposal, {
      scope,
      plan: {
        ...plan,
        state: 'DECLARADO_NO_VERIFICADO',
        applicable: false,
        reason: 'issuer-not-configured',
      },
    });
    expect(r.planNotAppliedReason).toBe('issuer-not-configured');
  });
});
