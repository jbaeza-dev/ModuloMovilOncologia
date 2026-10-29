import { describe, expect, it } from 'vitest';
import { eproHomeDescription } from './epro-home-status';

type Hub = Exclude<Parameters<typeof eproHomeDescription>[0], null>;
const hub = (patch: Partial<Hub> = {}): Hub =>
  ({
    status: { completed_at: '2026-10-28T01:00:00Z' },
    current: {},
    drafts: [],
    captures: [],
    ...patch,
  }) as Hub;

describe('home status of the replicated global ePRO', () => {
  it('keeps a late submission on its original Chilean tracking day', () => {
    const state = hub({
      captures: [
        { context: { fechaSeguimiento: '2026-10-27' }, submittedAt: '2026-10-28T05:00:00Z' },
      ] as Hub['captures'],
    });
    expect(eproHomeDescription(state, new Date('2026-10-28T05:00:00Z'))).toBe(
      'Completa tu cuestionario diario de seguimiento.',
    );
    state.captures[0]!.context.fechaSeguimiento = '2026-10-28';
    expect(eproHomeDescription(state, new Date('2026-10-28T05:00:00Z'))).toContain(
      'Revisa su estado de envío',
    );
  });
  it('retains an old draft independently of a missing current definition', () => {
    const state = hub({
      current: null,
      drafts: [{ context: { fechaSeguimiento: '2026-10-27' } }] as Hub['drafts'],
    });
    expect(eproHomeDescription(state, new Date('2026-10-28T05:00:00Z'))).toContain(
      'fecha original',
    );
  });
  it('does not announce a ready questionnaire before a complete catalog', () => {
    expect(eproHomeDescription(hub({ status: null }), new Date('2026-10-28T05:00:00Z'))).toContain(
      'definición completa',
    );
    expect(eproHomeDescription(null)).toContain('no está disponible');
  });
});
