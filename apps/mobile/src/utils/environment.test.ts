import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDemoMode } from './environment';

describe('isDemoMode', () => {
  const originalEnv = process.env.EXPO_PUBLIC_DEMO_MODE;
  const originalDev = (globalThis as Record<string, unknown>).__DEV__;

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_DEMO_MODE;
    (globalThis as Record<string, unknown>).__DEV__ = true;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.EXPO_PUBLIC_DEMO_MODE = originalEnv;
    } else {
      delete process.env.EXPO_PUBLIC_DEMO_MODE;
    }
    (globalThis as Record<string, unknown>).__DEV__ = originalDev;
  });

  it('activa el modo demo automáticamente en desarrollo cotidiano (__DEV__ === true)', () => {
    (globalThis as Record<string, unknown>).__DEV__ = true;
    delete process.env.EXPO_PUBLIC_DEMO_MODE;
    expect(isDemoMode()).toBe(true);

    process.env.EXPO_PUBLIC_DEMO_MODE = 'false';
    expect(isDemoMode()).toBe(true);
  });

  it('en modo Release (__DEV__ === false), requiere activación explícita con EXPO_PUBLIC_DEMO_MODE="true"', () => {
    (globalThis as Record<string, unknown>).__DEV__ = false;

    // Con variable ausente: debe ser false (no demo, acceso estándar)
    delete process.env.EXPO_PUBLIC_DEMO_MODE;
    expect(isDemoMode()).toBe(false);

    // Con variable "false": debe ser false
    process.env.EXPO_PUBLIC_DEMO_MODE = 'false';
    expect(isDemoMode()).toBe(false);

    // Con valores arbitrarios o mal escritos: debe ser false
    process.env.EXPO_PUBLIC_DEMO_MODE = 'yes';
    expect(isDemoMode()).toBe(false);

    process.env.EXPO_PUBLIC_DEMO_MODE = '1';
    expect(isDemoMode()).toBe(false);

    process.env.EXPO_PUBLIC_DEMO_MODE = 'TRUE';
    expect(isDemoMode()).toBe(false);

    // Únicamente con "true" exacto: se activa el modo demo
    process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
    expect(isDemoMode()).toBe(true);
  });
});
