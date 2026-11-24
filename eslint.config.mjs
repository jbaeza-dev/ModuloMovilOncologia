import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.agents/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.expo/**',
      'apps/mobile/android/**',
      'apps/mobile/assets/pdfjs/**',
      'test-stubs/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // En el APK los avisos van por devWarn(), que solo escribe en desarrollo.
    files: ['apps/mobile/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/__tests__/**'],
    rules: { 'no-console': 'error' },
  },
  eslintConfigPrettier,
);
