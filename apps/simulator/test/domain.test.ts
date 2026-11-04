import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../src/config.js';
import { signAccess, verifyAccess } from '../src/auth.js';
import { conditionsVersion, validateAnswers, validateDefinition } from '../src/forms.js';
import { normalizedSigns, equivalentSigns } from '../src/clinical.js';
import { FORMS } from '../src/seed-data.js';
import { PATIENTS } from '../src/types.js';
import type { FormDefinition } from '../src/types.js';

const config = readConfig({
  APP_ENV: 'demo',
  DATABASE_URL: 'postgres://synthetic.invalid/demo',
  DEMO_SIGNING_KEY: 'synthetic-unit-test-signing-key-not-production',
  DEMO_CONTROL_KEY: 'synthetic-unit-test-control-key-not-production',
  SIMULATOR_PUBLIC_BASE_URL: 'http://synthetic.invalid',
});

describe('real signed demo credentials', () => {
  it('checks signature, owner, audience, issuer and absolute expiration', () => {
    const at = Date.parse('2026-10-25T12:00:00Z');
    const token = signAccess(config, 'A', 'generation', at);
    expect(verifyAccess(config, token, at)).toEqual({
      id: PATIENTS.A,
      demo: 'A',
      generation: 'generation',
    });
    expect(() => verifyAccess(config, token, at + 3600000)).toThrow();
    expect(() => verifyAccess({ ...config, audience: 'other' }, token, at)).toThrow();
    expect(() => verifyAccess({ ...config, issuer: 'other' }, token, at)).toThrow();
    expect(() =>
      verifyAccess({ ...config, signingKey: 'different-synthetic-secret' }, token, at),
    ).toThrow();
    expect(() => verifyAccess(config, token + 'x', at)).toThrow();
  });
  it('rejects production mode and missing server credentials', () => {
    expect(() => readConfig({ APP_ENV: 'real' })).toThrow();
    expect(() => readConfig({ APP_ENV: 'demo' })).toThrow();
  });
});

describe('sign capture semantics', () => {
  it('preserva ENA en la normalización y distingue otro dolor al reintentar el UUID', () => {
    const input = {
      id: randomUUID(),
      fecha_registro: '2026-10-22T12:00:00Z',
      version_dolor: 1 as const,
      dolor_ena: 0,
    };
    const value = normalizedSigns(input);
    expect(value).toMatchObject({ version_dolor: 1, dolor_ena: 0 });
    expect(equivalentSigns(value, { ...value, dolor_ena: 1 })).toBe(false);
    expect(equivalentSigns(value, { ...value })).toBe(true);
    expect(() => normalizedSigns({ ...input, dolor_ena: 11 })).toThrow();
    expect(() =>
      normalizedSigns({ id: input.id, fecha_registro: input.fecha_registro, version_dolor: 1 }),
    ).toThrow();
  });
  it('accepts independent blood pressure values and preserves the original instant', () => {
    const input = {
      id: randomUUID(),
      fecha_registro: '2026-10-22T12:00:00-03:00',
      presion_arterial_sistolica: 120,
      temperatura: 36.64,
    };
    const value = normalizedSigns(input);
    expect(value.fecha_registro).toBe('2026-10-22T15:00:00.000Z');
    expect(value.presion_arterial_diastolica).toBeNull();
    expect(value.temperatura).toBe(36.6);
    expect(equivalentSigns(value, { ...value, fecha_registro: '2026-10-22T15:00:01Z' })).toBe(true);
    expect(equivalentSigns(value, { ...value, fecha_registro: '2026-10-22T15:00:02Z' })).toBe(
      false,
    );
  });
  it('rejects invalid pairs and capture more than five minutes in future', () => {
    const base = { id: randomUUID(), fecha_registro: '2026-10-22T12:00:00Z' };
    expect(() =>
      normalizedSigns({ ...base, presion_arterial_sistolica: 80, presion_arterial_diastolica: 80 }),
    ).toThrow();
    expect(() =>
      normalizedSigns({ ...base, fecha_registro: new Date(Date.now() + 301000).toISOString() }),
    ).toThrow();
  });
});

describe('ePRO domain rules independent of boundary schema', () => {
  const technical = structuredClone(FORMS[1]!) as FormDefinition;
  it('does not coerce false to zero or omit false mother answers', () => {
    const mother = technical.preguntas[0]!;
    expect(validateAnswers(technical, [{ pregunta_id: mother.id, valor: false }])).toHaveLength(1);
    expect(() => validateAnswers(technical, [{ pregunta_id: mother.id, valor: 0 }])).toThrow();
  });
  it('rejects hidden child even when null and missing active required child', () => {
    const [mother, child] = technical.preguntas;
    expect(() =>
      validateAnswers(technical, [
        { pregunta_id: mother!.id, valor: false },
        { pregunta_id: child!.id, valor: null },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'PREGUNTA_NO_APLICABLE' }));
    expect(() => validateAnswers(technical, [{ pregunta_id: mother!.id, valor: true }])).toThrow();
  });
  it('rejects cycles and incomplete conditions instead of degrading to legacy', () => {
    const malformed = structuredClone(technical);
    malformed.preguntas[0]!.configuracion = {
      depende_de: malformed.preguntas[1]!.codigo,
      valor_activador: 3,
      requerida_si_activa: true,
    };
    expect(() => validateDefinition(malformed)).toThrow();
    malformed.preguntas[0]!.configuracion = {};
    malformed.preguntas[1]!.configuracion = { depende_de: malformed.preguntas[0]!.codigo };
    expect(() => validateDefinition(malformed)).toThrow();
  });
  it('derives markers by key presence, including false, and rejects boolean marker', () => {
    const question = { ...technical.preguntas[0]!, configuracion: { requerida_si_activa: false } };
    expect(conditionsVersion({}, [question])).toBe(1);
    expect(conditionsVersion({}, [{ ...question, configuracion: { depende_de: 'X' } }])).toBe(0);
    expect(() => conditionsVersion({ version_condiciones: false }, [question])).toThrow();
    expect(() => conditionsVersion({ version_condiciones: 0 }, [question])).toThrow();
    expect(() => conditionsVersion([] as unknown as Record<string, unknown>, [question])).toThrow();
    expect(() =>
      conditionsVersion({}, [
        { ...question, configuracion: null as unknown as Record<string, unknown> },
      ]),
    ).toThrow();
  });
  it('enforces exclusive selection without silently cleaning duplicates', () => {
    const exclusive = structuredClone(FORMS[2]!);
    const q = exclusive.preguntas[0]!;
    expect(validateAnswers(exclusive, [{ pregunta_id: q.id, valor: ['SOLO_ESTA'] }])).toHaveLength(
      1,
    );
    for (const valor of [
      ['SOLO_ESTA', 'OP_A'],
      ['SOLO_ESTA', 'SOLO_ESTA'],
    ]) {
      expect(() => validateAnswers(exclusive, [{ pregunta_id: q.id, valor }])).toThrowError(
        expect.objectContaining({
          details: expect.objectContaining({ motivo: 'OPCIONES_EXCLUSIVAS_INCOMPATIBLES' }),
        }),
      );
    }
  });
  it('allows optional P10 up to500 Unicode codepoints without duplicating comentario', () => {
    const form = structuredClone(FORMS[0]!);
    const answers = form.preguntas
      .filter((q) => q.requerida)
      .map((q) => ({ pregunta_id: q.id, valor: false as unknown }));
    const comment = form.preguntas.find((q) => q.codigo === 'P10')!;
    expect(
      validateAnswers(form, [...answers, { pregunta_id: comment.id, valor: '😀'.repeat(500) }]),
    ).toHaveLength(answers.length + 1);
    expect(() =>
      validateAnswers(form, [...answers, { pregunta_id: comment.id, valor: 'a'.repeat(501) }]),
    ).toThrow();
  });
});
