import { resolve } from 'node:path';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [...coverageConfigDefaults.exclude],
      reportsDirectory: resolve(__dirname, '../../coverage/gateway-integration'),
      reporter: [
        ['text-summary'],
        ['json-summary'],
        ['html'],
        ['lcovonly', { projectRoot: resolve(__dirname, '../..') }],
      ],
      reportOnFailure: true,
    },
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
