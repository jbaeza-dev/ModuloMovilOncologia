import { ClinicalSyncNotice } from '../features/sync/ClinicalSyncNotice';
import Feather from '@expo/vector-icons/Feather';
import { useFonts } from 'expo-font';
import { router, Stack, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StatusBar, View } from 'react-native';
import { SessionNotice } from '../features/access/SessionScreens';

import { ThemeProvider, useAppTheme } from '../providers/ThemeProvider';
import { LocalDataProvider, useLocalData } from '../providers/LocalDataProvider';
import { isDemoMode } from '../utils/environment';

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

export function AppNavigator() {
  const { theme } = useAppTheme();
  const { patientId, isClosing } = useLocalData();
  const segments = useSegments();

  useEffect(() => {
    if (!patientId && !isClosing) {
      const inProtected = segments[0] === '(tabs)' || segments[0] === 'visor-infografia';
      if (inProtected) {
        if (isDemoMode()) {
          router.replace('/acceso/seleccionar-paciente');
        } else {
          router.replace('/acceso');
        }
      }
    }
  }, [patientId, isClosing, segments]);

  return (
    <View style={{ flex: 1 }}>
      <SessionNotice />
      <ClinicalSyncNotice />
      <StatusBar
        barStyle={theme.colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={Platform.OS === 'android' ? 'transparent' : undefined}
        translucent
      />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={Boolean(patientId && !isClosing)}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="visor-infografia"
            options={{ presentation: 'fullScreenModal', headerShown: false }}
          />
        </Stack.Protected>
        <Stack.Screen name="acceso" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </View>
  );
}
