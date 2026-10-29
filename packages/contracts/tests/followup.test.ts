import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import fixture from '../fixtures/epro-seguimiento-domiciliario-v1_1_0.json' with { type: 'json' };
import { validateResponse } from '../src/validation.js';
import { activeQuestionIds, validateFormDefinition, type FormEdition } from '../src/forms.js';
const form = fixture.formulario;
const identity = (code: string) => form.preguntas.find((q) => q.codigo === code)!.id;
const active = (values: Record<string, unknown>, code: string) =>
  activeQuestionIds(
    form,
    Object.entries(values).map(([code, valor]) => ({ pregunta_id: identity(code), valor })),
  ).has(identity(code));
describe('versioned mapping of the actual 41-question instrument', () => {
  it('keeps source provenance, 41 distinct identities, source codes and optional P10', () => {
    expect(form.preguntas).toHaveLength(41);
    expect(new Set(form.preguntas.map((q) => q.id)).size).toBe(41);
    expect(fixture.trazabilidad.sourceVersion).toBe('1.1.0');
    // Git normaliza los saltos de línea; se conserva también el hash de la copia original.
    const original = readFileSync(
      resolve('../..', fixture.trazabilidad.sourcePath),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(original).digest('hex')).toBe(
      fixture.trazabilidad.sourceSha256Lf,
    );
    expect(form.preguntas.find((q) => q.codigo === 'P10')).toMatchObject({
      requerida: false,
      configuracion: { max_length: 500 },
    });
    expect(() => validateFormDefinition(form)).not.toThrow();
  });
  it('accepts the own extension without changing or silently loosening original RC3.2', () => {
    expect(validateResponse('C-08', 200, form).errors).toEqual([]);
    expect(validateResponse('C-09', 200, form).errors).toEqual([]);
    const unmarked = { ...form } as Record<string, unknown>;
    delete unmarked.version_reglas_compuestas;
    expect(validateResponse('C-08', 200, unmarked).valid).toBe(false);
    for (const marker of [true, null, '1', 2])
      expect(
        validateResponse('C-09', 200, { ...form, version_reglas_compuestas: marker }).valid,
      ).toBe(false);
    expect(() => validateFormDefinition(unmarked as unknown as FormEdition)).toThrow();
  });
  it('conserves P2.4 exactly: P2 yes AND a vomiting option in P2.2', () => {
    for (const vomiting of ['vomito_1_2', 'vomito_3_5', 'vomito_6_mas']) {
      expect(active({ P2: 'si', 'P2.2': vomiting }, 'P2.4')).toBe(true);
      expect(active({ P2: 'no', 'P2.2': vomiting }, 'P2.4')).toBe(false);
    }
    expect(active({ P2: 'si', 'P2.2': null }, 'P2.4')).toBe(false);
    const other = form.preguntas
      .find((q) => q.codigo === 'P2.2')!
      .opciones!.find((o) => !o.codigo.startsWith('vomito_'))!;
    expect(active({ P2: 'si', 'P2.2': other.codigo }, 'P2.4')).toBe(false);
  });
  it('conserves P6.2 exactly: P6 yes AND P0.1 no', () => {
    expect(active({ P6: 'si', 'P0.1': 'no' }, 'P6.2')).toBe(true);
    expect(active({ P6: 'si', 'P0.1': 'si' }, 'P6.2')).toBe(false);
    expect(active({ P6: 'no', 'P0.1': 'no' }, 'P6.2')).toBe(false);
    expect(active({ P6: 'si', 'P0.1': null }, 'P6.2')).toBe(false);
  });
});
