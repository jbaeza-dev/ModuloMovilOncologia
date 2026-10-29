import { describe, expect, it } from 'vitest';
import {
  deriveConditionsVersion,
  validateFormDefinition,
  validateFormAnswers,
  activeQuestionIds,
  visibleAnswers,
  FormRuleError,
  type FormEdition,
  type FormQuestion,
} from '../src/forms.js';
const question = (
  id: string,
  type = 'booleano',
  configuration: Record<string, unknown> = {},
): FormQuestion => ({
  id,
  codigo: id,
  titulo: id,
  tipo: type,
  orden: 0,
  requerida: true,
  configuracion: configuration,
});
const mother = question('A'),
  other = question('B', 'numerico');
const child = question('C', 'texto_libre', {
  depende_de: 'A',
  valor_activador: true,
  requerida_si_activa: true,
  max_length: 500,
});
const form = (questions: FormQuestion[] = [mother, child], extension = false): FormEdition => ({
  id: 'edition',
  version: 1,
  version_condiciones: 1,
  ...(extension ? { version_reglas_compuestas: 1 } : {}),
  preguntas: structuredClone(questions),
});
describe('strict original semantics and explicit compound extension', () => {
  it.each([false, null, '1', 2])('rejects noncontractual marker %j', (marker) => {
    expect(() => deriveConditionsVersion({ version_condiciones: marker }, [mother])).toThrow();
  });
  it('derives only by key presence; exclusivity and compound rules require explicit markers', () => {
    expect(
      deriveConditionsVersion({}, [question('A', 'booleano', { requerida_si_activa: false })]),
    ).toBe(1);
    expect(
      deriveConditionsVersion({}, [question('A', 'booleano', { valor_activador: null })]),
    ).toBe(1);
    expect(
      deriveConditionsVersion({}, [question('A', 'booleano', { depende_de: 'unknown' })]),
    ).toBe(0);
    expect(() => deriveConditionsVersion({ version_condiciones: 0 }, [child])).toThrow();
    expect(() =>
      deriveConditionsVersion({}, [question('A', 'opcion_multiple', { opciones_exclusivas: [] })]),
    ).toThrow();
    expect(() => deriveConditionsVersion({ version_reglas_compuestas: 1 }, [child])).toThrow();
  });
  it('keeps false typed, omits hidden nulls, and requires children only when active', () => {
    expect(validateFormAnswers(form(), [{ pregunta_id: 'A', valor: false }])).toHaveLength(1);
    expect(() => validateFormAnswers(form(), [{ pregunta_id: 'A', valor: 0 }])).toThrow();
    expect(() =>
      validateFormAnswers(form(), [
        { pregunta_id: 'A', valor: false },
        { pregunta_id: 'C', valor: null },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'PREGUNTA_NO_APLICABLE' }));
    expect(() => validateFormAnswers(form(), [{ pregunta_id: 'A', valor: true }])).toThrow(
      'obligatoria',
    );
    expect(
      visibleAnswers(form(), [
        { pregunta_id: 'A', valor: false },
        { pregunta_id: 'C', valor: null },
      ]),
    ).toEqual([{ pregunta_id: 'A', valor: false }]);
  });
  it('supports numeric equality 1/1.0 but never boolean/numeric coercion or null activation', () => {
    const numericChild = question('C', 'texto_libre', {
      depende_de: 'B',
      valor_activador: 1.0,
      requerida_si_activa: false,
    });
    expect(
      activeQuestionIds(form([other, numericChild]), [{ pregunta_id: 'B', valor: 1 }]).has('C'),
    ).toBe(true);
    expect(
      activeQuestionIds(form([other, numericChild]), [{ pregunta_id: 'B', valor: null }]).has('C'),
    ).toBe(false);
    numericChild.configuracion!.valor_activador = false;
    expect(() => validateFormDefinition(form([other, numericChild]))).toThrow('activador');
  });
  it('rejects dangling, self, cyclic and type-incompatible definitions before showing them', () => {
    for (const parent of ['missing', 'C']) {
      const broken = structuredClone(child);
      broken.configuracion!.depende_de = parent;
      expect(() => validateFormDefinition(form([mother, broken]))).toThrow();
    }
    const a = question('A', 'booleano', {
      depende_de: 'C',
      valor_activador: true,
      requerida_si_activa: true,
    });
    expect(() => validateFormDefinition(form([a, { ...child, tipo: 'booleano' }]))).toThrow(
      'Ciclo',
    );
    expect(() =>
      validateFormDefinition(form([{ ...mother, tipo: 'texto_libre' }, child])),
    ).toThrow();
  });
  it('preserves multiple selections and returns explicit errors for exclusivity, duplicate or foreign codes', () => {
    const q = question('M', 'opcion_multiple', { opciones_exclusivas: ['NONE'] });
    q.opciones = [
      { codigo: 'NONE', etiqueta: 'None' },
      { codigo: 'X', etiqueta: 'X' },
    ];
    const edition = form([q]),
      selection = ['NONE', 'X'];
    expect(() =>
      validateFormAnswers(edition, [{ pregunta_id: 'M', valor: selection }]),
    ).toThrowError(expect.objectContaining({ reason: 'OPCIONES_EXCLUSIVAS_INCOMPATIBLES' }));
    expect(selection).toEqual(['NONE', 'X']);
    for (const value of [['X', 'X'], ['foreign']])
      expect(() => validateFormAnswers(edition, [{ pregunta_id: 'M', valor: value }])).toThrow(
        FormRuleError,
      );
    expect(validateFormAnswers(edition, [{ pregunta_id: 'M', valor: ['NONE'] }])).toHaveLength(1);
  });
  const compoundChild = () =>
    question('C', 'texto_libre', {
      activacion_compuesta: {
        op: 'todas',
        condiciones: [
          { op: 'igual', codigo: 'A', valor: true },
          { op: 'en', codigo: 'B', valores: [1, 2, 3] },
        ],
      },
      requerida_si_activa: true,
    });
  it('requires the compound marker and explicit nonambiguous operators', () => {
    expect(() => validateFormDefinition(form([mother, other, compoundChild()]))).toThrow(
      'ampliación',
    );
    const wrong = compoundChild();
    wrong.configuracion!.depende_de = 'A';
    expect(() => validateFormDefinition(form([mother, other, wrong], true))).toThrow();
    const unknown = compoundChild();
    unknown.configuracion!.activacion_compuesta = { op: 'automatic' };
    expect(() => validateFormDefinition(form([mother, other, unknown], true))).toThrow();
  });
  it('executes only the explicit conjunction and membership; inactive ancestors cannot activate descendants', () => {
    const edition = form([mother, other, compoundChild()], true);
    for (const [a, b, expected] of [
      [true, 1, true],
      [true, 1.0, true],
      [true, 0, false],
      [false, 1, false],
      [true, null, false],
    ] as const)
      expect(
        activeQuestionIds(edition, [
          { pregunta_id: 'A', valor: a },
          { pregunta_id: 'B', valor: b },
        ]).has('C'),
      ).toBe(expected);
    const b = question('B', 'numerico', {
      depende_de: 'A',
      valor_activador: true,
      requerida_si_activa: false,
    });
    expect(
      activeQuestionIds(form([mother, b, compoundChild()], true), [
        { pregunta_id: 'A', valor: false },
        { pregunta_id: 'B', valor: 1 },
      ]).has('C'),
    ).toBe(false);
  });
  it('validates compound references and all graph edges, including cycles through the second branch', () => {
    const a = question('A', 'booleano', {
      activacion_compuesta: { op: 'igual', codigo: 'B', valor: 1 },
      requerida_si_activa: true,
    });
    const b = question('B', 'numerico', {
      depende_de: 'A',
      valor_activador: true,
      requerida_si_activa: true,
    });
    expect(() => validateFormDefinition(form([a, b], true))).toThrow('Ciclo');
    const q = compoundChild();
    q.configuracion!.activacion_compuesta = { op: 'en', codigo: 'B', valores: [1, 1] };
    expect(() => validateFormDefinition(form([mother, other, q], true))).toThrow('duplicados');
  });
  it('keeps P10 optional and enforces 500 Unicode codepoints without a duplicate comment field', () => {
    const p10 = { ...question('P10', 'texto_libre'), requerida: false };
    expect(validateFormAnswers(form([p10]), [])).toEqual([]);
    expect(
      validateFormAnswers(form([p10]), [{ pregunta_id: 'P10', valor: '😀'.repeat(500) }])[0]!.valor,
    ).toBe('😀'.repeat(500));
    expect(() =>
      validateFormAnswers(form([p10]), [{ pregunta_id: 'P10', valor: 'a'.repeat(501) }]),
    ).toThrow('500');
  });
});
