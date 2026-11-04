module.exports = {
  preset: 'jest-expo',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/testing/**',
    '!src/features/preview/**',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: '<rootDir>/../../coverage/mobile-jest',
  coverageReporters: [
    'text-summary',
    'json-summary',
    'html',
    ['lcovonly', { projectRoot: `${__dirname}/../..` }],
  ],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@quimiocare/contracts/forms$': '<rootDir>/../../packages/contracts/src/forms.ts',
    '^@quimiocare/contracts/agenda$': '<rootDir>/../../packages/contracts/src/agenda.ts',
  },
  testMatch: ['**/__tests__/**/*.ui.test.[jt]s?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@powersync/.*|react-navigation|@react-navigation/.*|standard-navigation|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
};
