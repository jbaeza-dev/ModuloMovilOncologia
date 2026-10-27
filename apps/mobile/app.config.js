/* eslint-disable @typescript-eslint/no-require-imports -- Expo carga esta configuración como CommonJS. */
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const diagnostic = process.env.EXPO_PUBLIC_P01_PROBE_ENABLED === 'true';
  if (diagnostic && process.env.EXPO_PUBLIC_DEMO_MODE !== 'true') {
    throw new Error('El diagnóstico P01 requiere EXPO_PUBLIC_DEMO_MODE=true.');
  }
  let result = diagnostic
    ? { ...config, plugins: [...(config.plugins ?? []), './plugins/withP01Diagnostics.js'] }
    : config;
  if (process.env.EXPO_PUBLIC_P04_PROBE_ENABLED === 'true') {
    if (process.env.EXPO_PUBLIC_DEMO_MODE !== 'true')
      throw new Error('El diagnóstico P04 requiere modo demo.');
    result = { ...result, plugins: [...(result.plugins ?? []), './plugins/withP04Diagnostics.js'] };
  }
  if (
    process.env.EXPO_PUBLIC_P04_LAB_ONLY === 'true' &&
    (process.env.EXPO_PUBLIC_P04_PROBE_ENABLED !== 'true' ||
      process.env.EXPO_PUBLIC_DEMO_MODE !== 'true')
  ) {
    throw new Error('El laboratorio P04 requiere diagnóstico y modo demo explícitos.');
  }
  const googleServices = process.env.GOOGLE_SERVICES_JSON;
  if (googleServices) {
    const file = path.resolve(__dirname, googleServices);
    if (!fs.existsSync(file))
      throw new Error('GOOGLE_SERVICES_JSON no apunta a un archivo existente.');
    result = { ...result, android: { ...result.android, googleServicesFile: file } };
  }
  return result;
};
