// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest } = require('expo/config-plugins');

// Deja explícito en el manifiesto que la app no usa HTTP sin cifrar. La única excepción es la
// build de diagnóstico P01 por USB (withP01Diagnostics.js), que no se entrega a pacientes.
module.exports = (config) => {
  if (
    process.env.EXPO_PUBLIC_P01_PROBE_ENABLED === 'true' &&
    process.env.EXPO_PUBLIC_DEMO_MODE === 'true'
  ) {
    return config;
  }
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) throw new Error('No se encontró application en el manifiesto Android.');
    app.$['android:usesCleartextTraffic'] = 'false';
    return mod;
  });
};
