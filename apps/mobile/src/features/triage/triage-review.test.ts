import { afterEach, describe, expect, it, vi } from 'vitest';
import { syntheticReviewEnabled } from './triage-review';

afterEach(() => vi.unstubAllEnvs());

describe('acceso de revisión académica del triaje', () => {
  it.each([
    ['demo', 'true', true],
    ['universidad-demo', 'true', true],
    ['production', 'true', false],
    ['production', 'false', false],
    ['demo', 'false', false],
    ['universidad-demo', 'false', false],
    ['demo', undefined, false],
    ['universidad-demo', undefined, false],
    ['unexpected-profile', 'true', false],
  ] as const)('%s con bandera %s: acceso %s', (profile, flag, expected) => {
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', profile);
    vi.stubEnv('EXPO_PUBLIC_P07_SYNTHETIC_REVIEW', flag);
    expect(syntheticReviewEnabled()).toBe(expected);
  });
});
