// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest } = require('expo/config-plugins');

// Solo build explícita de diagnóstico sintético por USB; la entrega normal usa HTTPS.
module.exports = (config) => {
  if (
    process.env.EXPO_PUBLIC_P01_PROBE_ENABLED !== 'true' ||
    process.env.EXPO_PUBLIC_DEMO_MODE !== 'true'
  ) {
    return config;
  }
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) throw new Error('No se encontró application en el manifiesto Android.');
    app.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
};
