import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

const base = {
  APP_ENV: 'demo',
  DATABASE_URL: 'postgres://synthetic.invalid/demo',
  DEMO_SIGNING_KEY: 'synthetic-unit-test-signing-key-not-production',
  DEMO_CONTROL_KEY: 'synthetic-unit-test-control-key-not-production',
  SIMULATOR_PUBLIC_BASE_URL: 'http://synthetic.invalid/',
  GEMINI_API_KEY: 'clave-sintetica',
};

describe('configuración del simulador', () => {
  it('normaliza la lista de correos de operadores, sin duplicados ni vacíos', () => {
    const config = readConfig({
      ...base,
      OPERATOR_ALLOWED_EMAILS: ' Operador@Ejemplo.cl, ,operador@ejemplo.cl,otra@ejemplo.cl ',
    });
    expect(config.operatorAllowedEmails).toEqual(['operador@ejemplo.cl', 'otra@ejemplo.cl']);
    expect(config.publicBaseUrl).toBe('http://synthetic.invalid');
  });

  it('omite la lista cuando no se configura y rechaza un correo inválido', () => {
    expect('operatorAllowedEmails' in readConfig(base)).toBe(false);
    expect(readConfig({ ...base, OPERATOR_ALLOWED_EMAILS: '' }).operatorAllowedEmails).toEqual([]);
    expect(() => readConfig({ ...base, OPERATOR_ALLOWED_EMAILS: 'sin-arroba' })).toThrow(
      'OPERATOR_ALLOWED_EMAILS inválido.',
    );
  });

  it('respeta las rutas, servicios y claves configuradas', () => {
    const config = readConfig({
      ...base,
      EDUCATION_MEDIA_ROOT: '/datos/media',
      EDUCATION_TEMP_DIR: '/datos/temp',
      AI_SERVICE_URL: 'http://ia.interna:3003',
      SIMULATOR_HOST: '127.0.0.1',
      AUTH_EXPECTED_AUDIENCE: 'otra-audiencia',
      PREPARATION_ENABLED: 'true',
      API_DOCS_ENABLED: 'true',
    });
    expect(config).toMatchObject({
      educationMediaRoot: '/datos/media',
      educationTempDir: '/datos/temp',
      aiServiceUrl: 'http://ia.interna:3003',
      host: '127.0.0.1',
      audience: 'otra-audiencia',
      preparationEnabled: true,
      apiDocsEnabled: true,
      geminiApiKey: 'clave-sintetica',
      issuer: 'quimiocare-demo',
    });
  });

  it('rechaza servicio, puerto y base pública inválidos', () => {
    expect(() => readConfig({ ...base, SIMULATOR_SERVICE: 'otro' })).toThrow('SIMULATOR_SERVICE');
    expect(() => readConfig({ ...base, SIMULATOR_PORT: '70000' })).toThrow('SIMULATOR_PORT');
    expect(() =>
      readConfig({ ...base, SIMULATOR_PUBLIC_BASE_URL: 'ftp://synthetic.invalid' }),
    ).toThrow('Base pública inválida.');
    expect(readConfig({ ...base, SIMULATOR_SERVICE: 'ai' }).port).toBe(3003);
  });
});

describe('origen de la configuración', () => {
  it('no lee archivos .env ni modifica process.env, aunque falte la clave de Gemini', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const folder = mkdtempSync(join(tmpdir(), 'qc-sim-env-'));
    const previous = process.cwd();
    writeFileSync(
      join(folder, '.env.local'),
      'QC_SENTINEL_FROM_FILE=filtrado\nGEMINI_API_KEY=clave-del-archivo\n',
    );
    const before = { ...process.env };
    try {
      process.chdir(folder);
      const config = readConfig({ ...base, GEMINI_API_KEY: undefined });
      expect(config.geminiApiKey).toBeUndefined();
      expect(process.env.QC_SENTINEL_FROM_FILE).toBeUndefined();
      expect(process.env).toEqual(before);
    } finally {
      process.chdir(previous);
      rmSync(folder, { recursive: true, force: true });
      delete process.env.QC_SENTINEL_FROM_FILE;
    }
  });
});
