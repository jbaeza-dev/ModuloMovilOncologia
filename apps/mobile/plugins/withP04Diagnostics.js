// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');

// Diagnóstico sintético optativo por USB, fuera de CI y de la entrega normal.
module.exports = (config) => {
  if (
    process.env.EXPO_PUBLIC_P04_PROBE_ENABLED !== 'true' ||
    process.env.EXPO_PUBLIC_DEMO_MODE !== 'true'
  )
    return config;
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) throw new Error('No se encontró application en Android.');
    delete app.$['android:debuggable'];
    app.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    const marker = '// QuimioCare: diagnóstico P04 optativo';
    if (!mod.modResults.contents.includes(marker)) {
      if (!/release\s*\{/.test(mod.modResults.contents))
        throw new Error('Falta buildType release.');
      mod.modResults.contents = mod.modResults.contents.replace(
        /release\s*\{/,
        'release {\n            ' + marker + '\n            debuggable true',
      );
    }
    return mod;
  });
};
