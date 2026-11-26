import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (!config.name || !config.slug) throw new Error('Faltan nombre y slug de Expo.');
  const android = { ...config.android };
  // Firebase config stays local or is supplied by CI; clean checkouts must still support local builds.
  if (android.googleServicesFile && !existsSync(resolve(__dirname, android.googleServicesFile)))
    delete android.googleServicesFile;
  return { ...config, name: config.name, slug: config.slug, android };
};
