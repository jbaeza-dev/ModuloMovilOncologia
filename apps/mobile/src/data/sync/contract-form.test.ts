import { describe, expect, it } from 'vitest';
import { formSections } from './contract-form';
import type { DefinitionSnapshot } from './catalog';

const snapshot = (config: Record<string, unknown>, modules: unknown[]): DefinitionSnapshot => ({
  form: { titulo: 'Synthetic definition', configuracion: config },
  questions: modules.map((modulo) => ({ configuracion: modulo === undefined ? {} : { modulo } })),
});
describe('section coverage before rendering a replicated edition', () => {
  it('derives sections from every question module when the source has no section list', () => {
    expect(formSections(snapshot({}, ['one', 'two', 'one', undefined])).map((s) => s.id)).toEqual([
      'one',
      'two',
      'general',
    ]);
  });
  it('rejects an empty, malformed or incomplete declared section list instead of hiding questions', () => {
    for (const secciones of [[], null, [{ id: 'one', titulo: 'One', orden: 0 }]])
      expect(() => formSections(snapshot({ secciones }, ['one', 'two']))).toThrow();
  });
  it('uses the source order only after verifying that all questions belong to a section', () => {
    expect(
      formSections(
        snapshot(
          {
            secciones: [
              { id: 'two', titulo: 'Two', orden: 2 },
              { id: 'one', titulo: 'One', orden: 1 },
            ],
          },
          ['two', 'one'],
        ),
      ).map((s) => s.id),
    ).toEqual(['one', 'two']);
  });
});
