/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads CommonJS configuration. */
const { getDefaultConfig } = require('expo/metro-config');
const { createHash } = require('node:crypto');

const config = getDefaultConfig(__dirname);
// Expo disables --reset-cache in CI. Separate transformed modules for each public
// environment so a cached demo/laboratory bundle cannot enter another variant.
const publicEnvironment = Object.entries(process.env)
  .filter(([key]) => key.startsWith('EXPO_PUBLIC_'))
  .sort(([left], [right]) => left.localeCompare(right));
config.cacheVersion =
  'quimiocare-public-env-' +
  createHash('sha256').update(JSON.stringify(publicEnvironment)).digest('hex');

module.exports = config;
