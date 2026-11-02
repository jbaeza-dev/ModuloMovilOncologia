module.exports = {
  preset: 'jest-expo',
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
