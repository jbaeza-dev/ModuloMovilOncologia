import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config/index.js';
import { environment, testConfig } from './fixtures.js';

describe('Validated gateway configuration', () => {
  it('requires every mandatory setting and never includes its value in errors', () => {
    for (const key of Object.keys(environment)) {
      const env: NodeJS.ProcessEnv = { ...environment };
      delete env[key];
      expect(() => readConfig(env)).toThrow(/Configuración inválida:/);
    }
    expect(() => testConfig({ AUTH_VERIFY_KEY: 'secret' })).toThrow('AUTH_VERIFY_KEY');
    expect(() =>
      testConfig({ GATEWAY_DATABASE_URL: 'postgresql://user:private-password@host/wrong' }),
    ).not.toThrow(/private-password/);
  });

  it.each([
    { APP_ENV: 'dev' },
    { GATEWAY_PORT: '0' },
    { GATEWAY_PORT: '3.2' },
    { GATEWAY_PORT: '65536' },
    { AUTH_ALLOWED_ALGORITHM: 'none' },
    { PUSH_PROVIDER: 'fcm' },
    { AGENDA_MAX_REMINDERS: '101' },
    { AGENDA_TIMEZONE: 'UTC' },
    { CLINICAL_API_URL: 'http://user:password@host' },
    { AI_API_URL: 'http://host?token=secret' },
    { AI_TIMEOUT_MS: '65000' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { GATEWAY_DATABASE_URL: 'postgresql://u:p@host/qc_gateway_real' },
  ])('rejects invalid operational settings %#', (env) => {
    expect(() => testConfig(env)).toThrow();
  });

  it('has explicit safe defaults and keeps demo separate', () => {
    expect(testConfig()).toMatchObject({
      appEnv: 'demo',
      port: 3001,
      pushProvider: 'expo',
      aiTimeoutMs: 60000,
      agendaMaxReminders: 100,
    });
  });

  it('requires HTTPS, verified database TLS and a non-demo issuer in production', () => {
    const production = {
      APP_ENV: 'production',
      GATEWAY_DATABASE_URL: 'postgresql://u:p@db/qc_gateway_real?sslmode=verify-full',
      AUTH_EXPECTED_ISSUER: 'https://auth.example.test',
      CLINICAL_API_URL: 'https://clinical.example.test',
      AI_API_URL: 'https://ai.example.test',
    };
    expect(testConfig(production).appEnv).toBe('production');
    expect(() => testConfig({ ...production, AI_API_URL: 'http://ai' })).toThrow();
    expect(() => testConfig({ ...production, AUTH_EXPECTED_ISSUER: 'quimiocare-demo' })).toThrow();
    expect(() =>
      testConfig({
        ...production,
        GATEWAY_DATABASE_URL: 'postgresql://u:p@db/qc_gateway_real?sslmode=disable',
      }),
    ).toThrow();
  });

  it('enforces hardened security rules in universidad-demo mode', () => {
    const universidadDemo = {
      APP_ENV: 'universidad-demo',
      GATEWAY_DATABASE_URL: 'postgresql://u:p@db/qc_gateway_demo_uni',
      AUTH_EXPECTED_ISSUER: 'https://quimiocare.supabase.co/auth/v1',
      AUTH_ALLOWED_ALGORITHM: 'ES256',
      AUTH_JWKS_URL: 'https://quimiocare.supabase.co/auth/v1/.well-known/jwks.json',
      AUTH_VERIFY_KEY: undefined,
      GATEWAY_CURSOR_KEY: 'synthetic-cursor-key-minimum-32-chars-long',
    };
    expect(testConfig(universidadDemo).appEnv).toBe('universidad-demo');

    expect(() =>
      testConfig({
        ...universidadDemo,
        AUTH_ALLOWED_ALGORITHM: 'HS256',
        AUTH_VERIFY_KEY: 'synthetic-key-32-bytes-long-for-test',
      }),
    ).toThrow('AUTH_ALLOWED_ALGORITHM');

    expect(() =>
      testConfig({
        ...universidadDemo,
        AUTH_EXPECTED_ISSUER: 'http://insecure-issuer.test',
      }),
    ).toThrow('AUTH_EXPECTED_ISSUER');

    expect(() =>
      testConfig({
        ...universidadDemo,
        AUTH_JWKS_URL: 'http://arbitrary-insecure-jwks.test/jwks.json',
      }),
    ).toThrow('AUTH_JWKS_URL');

    expect(
      testConfig({
        ...universidadDemo,
        AUTH_JWKS_MODE: 'distributed',
        AUTH_JWKS_URL: 'http://qc-jwks:3004/jwks.json',
      }).authJwksUrl,
    ).toBe('http://qc-jwks:3004/jwks.json');
  });
});
