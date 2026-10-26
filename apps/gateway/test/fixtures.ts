import { readConfig } from '../src/config/index.js';
export const environment = {
  APP_ENV: 'demo',
  GATEWAY_DATABASE_URL: 'postgresql://test:synthetic@127.0.0.1:1/qc_gateway_demo_test',
  CLINICAL_API_URL: 'http://127.0.0.1:3002',
  AI_API_URL: 'http://127.0.0.1:3003',
  AUTH_EXPECTED_ISSUER: 'quimiocare-demo',
  AUTH_EXPECTED_AUDIENCE: 'authenticated',
  AUTH_ALLOWED_ALGORITHM: 'HS256',
  AUTH_VERIFY_KEY: 'synthetic-test-only-verification-key-32-bytes',
  PUSH_PROVIDER: 'expo',
};
export const testConfig = (overrides: NodeJS.ProcessEnv = {}) =>
  readConfig({ ...environment, ...overrides });
