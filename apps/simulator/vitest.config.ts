import { resolve } from 'node:path';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [...coverageConfigDefaults.exclude],
      reportsDirectory: resolve(__dirname, '../../coverage/simulator'),
      reporter: [
        ['text-summary'],
        ['json-summary'],
        ['html'],
        ['lcovonly', { projectRoot: resolve(__dirname, '../..') }],
      ],
      reportOnFailure: true,
    },
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.integration.test.ts'],
  },
});
