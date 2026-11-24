// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest } = require('expo/config-plugins');

/** Deja explícito en el manifiesto que la app nunca usa HTTP sin cifrar. */
function applySecureNetwork(manifest) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error('No se encontró application en el manifiesto Android.');
  app.$['android:usesCleartextTraffic'] = 'false';
  return manifest;
}

module.exports = (config) =>
  withAndroidManifest(config, (mod) => {
    applySecureNetwork(mod.modResults);
    return mod;
  });
module.exports.applySecureNetwork = applySecureNetwork;
