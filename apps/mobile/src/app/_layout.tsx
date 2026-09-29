import Feather from '@expo/vector-icons/Feather';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { Platform, StatusBar } from 'react-native';

import { ThemeProvider, useAppTheme } from '../providers/ThemeProvider';
import { LocalDataProvider } from '../providers/LocalDataProvider';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const [loaded, error] = useFonts(Feather.font);
  if (error) throw error;
  if (!loaded) return null;

  return (
    <ThemeProvider>
      <LocalDataProvider>
        <AppNavigator />
      </LocalDataProvider>
    </ThemeProvider>
  );
}

function AppNavigator() {
  const { theme } = useAppTheme();

  return (
    <>
      <StatusBar
        barStyle={theme.colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={Platform.OS === 'android' ? 'transparent' : undefined}
        translucent
      />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="acceso" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
