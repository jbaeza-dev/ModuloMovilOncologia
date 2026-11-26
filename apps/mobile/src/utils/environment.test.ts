import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDemoMode } from './environment';

describe('isDemoMode', () => {
  const originalAppEnv = process.env.EXPO_PUBLIC_APP_ENV;
  const originalDemo = process.env.EXPO_PUBLIC_DEMO_MODE;
  const originalDev = (globalThis as Record<string, unknown>).__DEV__;

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_APP_ENV;
    delete process.env.EXPO_PUBLIC_DEMO_MODE;
  });

  afterEach(() => {
    if (originalAppEnv !== undefined) process.env.EXPO_PUBLIC_APP_ENV = originalAppEnv;
    else delete process.env.EXPO_PUBLIC_APP_ENV;
    if (originalDemo !== undefined) process.env.EXPO_PUBLIC_DEMO_MODE = originalDemo;
    else delete process.env.EXPO_PUBLIC_DEMO_MODE;
    (globalThis as Record<string, unknown>).__DEV__ = originalDev;
  });

  it('solo se activa con EXPO_PUBLIC_APP_ENV=demo, que usan las pruebas automáticas', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'demo';
    expect(isDemoMode()).toBe(true);
    process.env.EXPO_PUBLIC_APP_ENV = 'universidad-demo';
    expect(isDemoMode()).toBe(false);
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    expect(isDemoMode()).toBe(false);
  });

  it('una compilación de desarrollo sin entorno ya no entra en modo demo', () => {
    (globalThis as Record<string, unknown>).__DEV__ = true;
    expect(isDemoMode()).toBe(false);
  });

  it('la variable antigua EXPO_PUBLIC_DEMO_MODE ya no lo activa', () => {
    (globalThis as Record<string, unknown>).__DEV__ = false;
    process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
    expect(isDemoMode()).toBe(false);
  });
});
