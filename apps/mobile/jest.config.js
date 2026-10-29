module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@quimiocare/contracts/forms$': '<rootDir>/../../packages/contracts/src/forms.ts',
    '^@quimiocare/contracts/agenda$': '<rootDir>/../../packages/contracts/src/agenda.ts',
  },
  testMatch: ['**/__tests__/**/*.ui.test.[jt]s?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
};
