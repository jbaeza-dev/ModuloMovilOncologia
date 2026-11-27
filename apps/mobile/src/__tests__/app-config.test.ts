import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(projectRoot, 'package.json'));
const expoConfig = require(
  require.resolve('@expo/config', { paths: [require.resolve('expo/package.json')] }),
) as typeof import('@expo/config');
const { applySecureNetwork } = require('./plugins/withSecureNetwork.js') as {
  applySecureNetwork: (manifest: {
    manifest: { application?: { $: Record<string, string> }[] };
  }) => void;
};

const { applyOkHttpKeepalive, PING_SECONDS } = require('./plugins/withOkHttpKeepalive.js') as {
  applyOkHttpKeepalive: (contents: string) => string;
  PING_SECONDS: number;
};

/** MainApplication.kt tal como lo genera Expo SDK 57 (React Native 0.86). */
const MAIN_APPLICATION = [
  'package cl.ubiobio.quimiocare',
  '',
  'import android.app.Application',
  'import android.content.res.Configuration',
  '',
  'class MainApplication : Application(), ReactApplication {',
  '  override fun onCreate() {',
  '    super.onCreate()',
  '    loadReactNative(this)',
  '    ApplicationLifecycleDispatcher.onApplicationCreate(this)',
  '  }',
  '}',
  '',
].join('\n');

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

function plugins() {
  const { exp } = expoConfig.getConfig(projectRoot, { skipSDKVersionRequirement: true });
  return (exp.plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
}

describe('configuración Expo del APK universitario', () => {
  it('usa una sola configuración dinámica: app.config.ts', () => {
    expect(existsSync(resolve(projectRoot, 'app.config.js'))).toBe(false);
    expect(expoConfig.getConfigFilePaths(projectRoot).dynamicConfigPath).toBe(
      resolve(projectRoot, 'app.config.ts'),
    );
  });

  it('no incluye plugins de diagnóstico, aunque se pidan por variables de entorno', () => {
    process.env.EXPO_PUBLIC_P01_PROBE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_P04_PROBE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
    const names = plugins();
    expect(names).toContain('./plugins/withSecureNetwork.js');
    expect(names.some((name) => /withP0\dDiagnostics/.test(String(name)))).toBe(false);
    for (const file of ['withP01Diagnostics.js', 'withP04Diagnostics.js'])
      expect(existsSync(resolve(projectRoot, 'plugins', file))).toBe(false);
  });

  it('el manifiesto prohíbe el tráfico sin cifrar en cualquier compilación', () => {
    process.env.EXPO_PUBLIC_P01_PROBE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
    const manifest = {
      manifest: { application: [{ $: { 'android:usesCleartextTraffic': 'true' } }] },
    };
    applySecureNetwork(manifest);
    expect(manifest.manifest.application[0]!.$['android:usesCleartextTraffic']).toBe('false');
  });

  it('falla de forma explícita si el manifiesto no tiene application', () => {
    expect(() => applySecureNetwork({ manifest: {} })).toThrow(/application/);
  });

  it('registra el plugin que agrega el ping HTTP/2 al cliente de red', () => {
    expect(plugins()).toContain('./plugins/withOkHttpKeepalive.js');
  });

  it('instala la fábrica con ping antes de cargar React Native, una sola vez', () => {
    const once = applyOkHttpKeepalive(MAIN_APPLICATION);
    expect(once).toContain('import com.facebook.react.modules.network.OkHttpClientProvider');
    expect(once).toContain('import java.util.concurrent.TimeUnit');
    expect(once).toContain(`.pingInterval(${PING_SECONDS}, TimeUnit.SECONDS)`);
    expect(once).toContain('OkHttpClientProvider.createClientBuilder(applicationContext)');
    // La fábrica debe existir antes de que React Native o Expo creen su cliente.
    expect(once.indexOf('setOkHttpClientFactory')).toBeGreaterThan(
      once.indexOf('super.onCreate()'),
    );
    expect(once.indexOf('setOkHttpClientFactory')).toBeLessThan(once.indexOf('loadReactNative'));
    expect(applyOkHttpKeepalive(once)).toBe(once);
    expect(PING_SECONDS).toBeGreaterThan(0);
    expect(PING_SECONDS).toBeLessThan(60);
  });

  it('falla de forma explícita si MainApplication no tiene el formato esperado', () => {
    expect(() => applyOkHttpKeepalive('class Otra {}')).toThrow(/formato inesperado/);
    expect(() =>
      applyOkHttpKeepalive('package cl.x\n\nclass MainApplication : Application() {}\n'),
    ).toThrow(/super.onCreate/);
  });
});
