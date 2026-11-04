import { describe, expect, it } from 'vitest';
import type { PlanAssessment } from './palliative-plan';
import { proposal, questions } from './triage-definition';
import { evaluateOrientation, type OrientationInput } from './triage-engine';

const complete = (): OrientationInput => ({
  answers: Object.fromEntries(questions.map((q) => [q.id, q.group === 'C' ? 'yes' : 'no'])),
  informant: 'PACIENTE',
  pain: 0,
  painSource: 'self',
});
describe('propuesta oncológica v0.5: prueba técnica, aprobación clínica pendiente', () => {
  it('impide usar el borrador como orientación clínica aunque todas las respuestas estén completas', () => {
    expect(evaluateOrientation(complete())).toMatchObject({
      availability: 'disabled',
      outcome: null,
    });
    expect(proposal.approval).toBeNull();
  });
  it('no convierte el silencio o los datos incompletos en C', () => {
    const result = evaluateOrientation({ answers: {}, informant: null, pain: null }, 'synthetic');
    expect(result.outcome).toBe('D');
    expect(result.complete).toBe(false);
  });
  it('conserva todas las alarmas y A1 prevalece sobre A2, B y datos desconocidos', () => {
    const result = evaluateOrientation(
      {
        answers: { 'A1-RESP': 'yes', 'A2-INGESTA': 'yes', 'B-SYMPTOMS': 'yes' },
        pain: null,
        informant: 'CUIDADOR_FAMILIAR',
      },
      'synthetic',
    );
    expect(result.outcome).toBe('A1');
    expect(result.complete).toBe(false);
    expect(result.matchedRules).toEqual(
      expect.arrayContaining(['A1-RESP', 'A2-INGESTA', 'B-SYMPTOMS']),
    );
  });
  it('una medición normal no anula la alarma y no se necesita termómetro', () => {
    const input = complete();
    input.answers['A2-INFECCION'] = 'yes';
    expect(evaluateOrientation(input, 'synthetic').outcome).toBe('A2');
    expect(
      evaluateOrientation(
        {
          ...input,
          temperature: { value: 36.5, site: 'axillary', measuredAt: '2026-11-02T20:00:00Z' },
        },
        'synthetic',
      ).outcome,
    ).toBe('A2');
  });
  it('deja sin resolver el umbral térmico y nunca fabrica una política axilar', () => {
    const result = evaluateOrientation(
      {
        ...complete(),
        temperature: { value: 37.7, site: 'axillary', measuredAt: '2026-11-02T20:00:00Z' },
      },
      'synthetic',
    );
    expect(result.outcome).toBe('D');
    expect(result.pendingResolutions).toEqual(['R06', 'R07']);
  });
  it.each([0, 3])(
    'permite C sintético con ENA %s solo con todos sus requisitos conjuntos',
    (pain) => {
      expect(evaluateOrientation({ ...complete(), pain }, 'synthetic').outcome).toBe('C');
      const input = complete();
      input.answers['C-PLAN'] = 'unknown';
      expect(evaluateOrientation({ ...input, pain }, 'synthetic').outcome).toBe('D');
    },
  );
  it.each([7, 10])('ENA %s aplica la salida B propuesta sin dosis ni diagnóstico', (pain) => {
    expect(evaluateOrientation({ ...complete(), pain }, 'synthetic').outcome).toBe('B');
  });
  it('ENA baja no anula una alarma torácica', () => {
    const input = complete();
    input.answers['A1-TORAX'] = 'yes';
    input.pain = 2;
    expect(evaluateOrientation(input, 'synthetic').outcome).toBe('A1');
  });
  it('D ofrece una aclaración opcional y no exige otra después del primer intento', () => {
    const input = { ...complete(), informant: null };
    expect(evaluateOrientation(input, 'synthetic').clarificationOffered).toBe(true);
    expect(
      evaluateOrientation(
        { ...input, clarification: { attempted: true, question: 'informant', answer: 'unknown' } },
        'synthetic',
      ).clarificationOffered,
    ).toBe(false);
  });
  it('rechaza una edición que se declara aprobada sin resoluciones y acta', () => {
    expect(() =>
      evaluateOrientation(complete(), 'clinical', { ...proposal, status: 'approved' }),
    ).toThrow('aprobación');
  });
  it('no deduce una ventana de nadir del día de la última quimioterapia', () => {
    const temperature = {
      value: 37.7,
      site: 'axillary' as const,
      measuredAt: '2026-11-02T20:00:00Z',
    };
    const results = ['2026-10-25', '2026-10-17'].map((lastAdministration) =>
      evaluateOrientation(
        {
          ...complete(),
          temperature,
          treatment: { lastAdministration, precision: 'exact', source: 'patient' },
        },
        'synthetic',
      ),
    );
    expect(results.map((v) => v.outcome)).toEqual(['D', 'D']);
  });
});

describe('fronteras técnicas de la vía individual y aclaración', () => {
  const plan: PlanAssessment = {
    state: 'VERIFICADO_LOCAL',
    applicable: true,
    reason: 'individual-plan-applicable',
    planId: 'synthetic-plan',
    version: 1,
    contentHash: 'a'.repeat(64),
    trustCheckedAt: '2026-11-02T10:00:00Z',
    patientId: 'patient-a',
    environment: 'test',
    coveredSignals: ['A1-RESP'],
    instructions: 'Instrucción sintética pactada.',
    contingency: 'Contingencia sintética pactada.',
    contact: 'Contacto sintético',
  };
  const scope = { patientId: 'patient-a', environment: 'test' };
  it('cambia la vía con una constancia verificada aplicable sin rebajar A1 ni generar rescates', () => {
    const input = complete();
    input.answers['A1-RESP'] = 'yes';
    const result = evaluateOrientation(input, 'synthetic', proposal, { scope, plan });
    expect(result).toMatchObject({
      outcome: 'A1',
      route: 'individual-plan',
      planApplied: { id: plan.planId, version: 1 },
    });
    expect(result.message).toContain(plan.instructions);
    expect(result.message).toContain(plan.contingency);
  });
  it.each(['context', 'coverage', 'unverified', 'unavailable'])(
    'no aplica la vía individual si falla %s y conserva todas las alarmas',
    (failure) => {
      const input = complete();
      input.answers['A1-RESP'] = 'yes';
      const rejected = { ...plan };
      if (failure === 'context') rejected.patientId = 'patient-b';
      if (failure === 'coverage') input.answers['A2-INGESTA'] = 'yes';
      if (failure === 'unverified') rejected.state = 'DECLARADO_NO_VERIFICADO';
      if (failure === 'unavailable') {
        rejected.applicable = false;
        rejected.reason = 'contingency-required';
      }
      const result = evaluateOrientation(input, 'synthetic', proposal, { scope, plan: rejected });
      expect(result).toMatchObject({ outcome: 'A1', route: 'general' });
      expect(result.planApplied).toBeUndefined();
    },
  );
  it('una aclaración no borra la señal positiva previamente identificada', () => {
    const result = evaluateOrientation(
      { ...complete(), positiveSignals: ['A1-RESP'] },
      'synthetic',
    );
    expect(result).toMatchObject({ outcome: 'A1', complete: false });
    expect(result.missing).toContain('contradiction:A1-RESP');
  });
  it('ENA no obtenible y temperatura inválida no frenan una alarma suficiente', () => {
    const input = complete();
    input.answers['A1-CONCIENCIA'] = 'yes';
    const result = evaluateOrientation(
      {
        ...input,
        pain: null,
        painSource: 'unavailable',
        temperature: { value: 1000, site: 'unknown', measuredAt: 'invalid' },
      },
      'synthetic',
    );
    expect(result).toMatchObject({ outcome: 'A1', complete: false });
    expect(result.missing).toEqual(expect.arrayContaining(['pain', 'temperature-invalid']));
  });
});
