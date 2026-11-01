import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

describe('universidad-demo configuration', () => {
  it('accepts APP_ENV=universidad-demo with supabase auth provider and JWKS URL', () => {
    const config = readConfig({
      APP_ENV: 'universidad-demo',
      DATABASE_URL: 'postgres://synthetic.invalid/demo',
      DEMO_CONTROL_KEY: 'synthetic-unit-test-control-key-not-production',
      SIMULATOR_PUBLIC_BASE_URL: 'https://parra.chillan.ubiobio.cl/quimiocare',
      AUTH_EXPECTED_ISSUER: 'https://quimiocare-auth.supabase.co/auth/v1',
      AUTH_JWKS_URL: 'https://quimiocare-auth.supabase.co/auth/v1/.well-known/jwks.json',
    });

    expect(config.appEnv).toBe('universidad-demo');
    expect(config.authProvider).toBe('supabase');
    expect(config.issuer).toBe('https://quimiocare-auth.supabase.co/auth/v1');
    expect(config.authJwksUrl).toBe(
      'https://quimiocare-auth.supabase.co/auth/v1/.well-known/jwks.json',
    );
    expect(config.publicBaseUrl).toBe('https://parra.chillan.ubiobio.cl/quimiocare');
  });

  it('validates 8-character linking code format strictly', () => {
    const regex = /^[A-Z0-9]{8}$/;
    expect(regex.test('ABCD1234')).toBe(true);
    expect(regex.test('A1B2C3D4')).toBe(true);
    // Invalid codes
    expect(regex.test('ABC1234')).toBe(false); // 7 chars
    expect(regex.test('ABCD12345')).toBe(false); // 9 chars
    expect(regex.test('ABCD-123')).toBe(false); // Hyphen
    expect(regex.test('abcd1234')).toBe(false); // Lowercase
  });
});
