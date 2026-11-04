import { resolve } from 'node:path';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [...coverageConfigDefaults.exclude, 'src/generated-*.ts'],
      reportsDirectory: resolve(__dirname, '../../coverage/contracts'),
      reporter: [
        ['text-summary'],
        ['json-summary'],
        ['html'],
        ['lcovonly', { projectRoot: resolve(__dirname, '../..') }],
      ],
      reportOnFailure: true,
    },
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
