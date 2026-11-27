import { resolve } from 'node:path';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      all: true,
      include: ['apps/mobile/src/**/*.ts'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'apps/mobile/src/**/testing/**',
        'apps/mobile/src/features/preview/**',
        // Los hooks de React se ejercitan desde las pantallas y se miden en Jest; así cada archivo
        // se informa una sola vez y SonarQube no suma las condiciones de dos reportes.
        'apps/mobile/src/**/use-*.ts',
        'apps/mobile/src/**/use[A-Z]*.ts',
      ],
      reportsDirectory: resolve(__dirname, 'coverage/mobile-vitest'),
      reporter: [
        ['text-summary'],
        ['json-summary'],
        ['html'],
        ['lcovonly', { projectRoot: resolve(__dirname, '.') }],
      ],
      reportOnFailure: true,
    },
    environment: 'node',
    include: ['apps/mobile/src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@quimiocare/contracts/agenda': resolve(__dirname, 'packages/contracts/src/agenda.ts'),
      '@quimiocare/contracts/forms': resolve(__dirname, 'packages/contracts/src/forms.ts'),
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
