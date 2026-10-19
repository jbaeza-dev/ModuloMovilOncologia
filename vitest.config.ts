import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/mobile/src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      'react-native': resolve(__dirname, 'test-stubs/react-native.js'),
      'expo-file-system': resolve(__dirname, 'test-stubs/expo-file-system.js'),
      'expo-sharing': resolve(__dirname, 'test-stubs/expo-sharing.js'),
      'expo-crypto': resolve(__dirname, 'test-stubs/expo-crypto.js'),
      'expo-linking': resolve(__dirname, 'test-stubs/expo-linking.js'),
      'expo-asset': resolve(__dirname, 'test-stubs/expo-asset.js'),
    },
  },
  define: {
    __DEV__: true,
  },
});
