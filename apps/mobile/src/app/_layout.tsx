import { GlobalStatusNotice } from '../features/sync/GlobalStatusNotice';
import Feather from '@expo/vector-icons/Feather';
import { useFonts } from 'expo-font';
import { router, Stack, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StatusBar, View } from 'react-native';

import { ThemeProvider, useAppTheme } from '../providers/ThemeProvider';
import { LocalDataProvider, useLocalData } from '../providers/LocalDataProvider';
import { PodcastPlaybackProvider } from '../features/education/PodcastPlaybackContext';
import { useIdentity } from '../features/access/SessionScreens';
import { isDemoMode } from '../utils/environment';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const [loaded, error] = useFonts({
    ...Feather.font,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'NunitoSans-Regular': require('../../assets/fonts/NunitoSans-Regular.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'NunitoSans-SemiBold': require('../../assets/fonts/NunitoSans-SemiBold.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'NunitoSans-Bold': require('../../assets/fonts/NunitoSans-Bold.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'NunitoSans-ExtraBold': require('../../assets/fonts/NunitoSans-ExtraBold.ttf'),
  });
  if (error) throw error;
  if (!loaded) return null;

  return (
    <ThemeProvider>
      <LocalDataProvider>
        <PodcastPlaybackProvider>
          <AppNavigator />
        </PodcastPlaybackProvider>
      </LocalDataProvider>
    </ThemeProvider>
  );
}

export function AppNavigator() {
  const { theme } = useAppTheme();
  const { patientId, isClosing } = useLocalData();
  const { snapshot } = useIdentity();
  const segments = useSegments();

  const isProfileComplete =
    isDemoMode() ||
    !snapshot.identity ||
    Boolean(snapshot.identity.profile?.rut && snapshot.identity.profile.rut.trim().length > 0);

  useEffect(() => {
    if (!patientId && !isClosing) {
      const inProtected =
        segments[0] === '(tabs)' ||
        segments[0] === 'visor-infografia' ||
        segments[0] === 'reportes' ||
        segments[0] === 'educacion' ||
        segments[0] === 'perfil' ||
        segments[0] === 'recordatorios' ||
        segments[0] === 'asistente' ||
        segments[0] === 'avisos' ||
        segments[0] === 'vitales' ||
        segments[0] === 'formulario';
      if (inProtected) {
        if (isDemoMode()) {
          router.replace('/acceso/seleccionar-paciente');
        } else {
          router.replace('/acceso');
        }
      }
    } else if (patientId && !isClosing && !isProfileComplete) {
      if (segments[0] === '(tabs)') {
        router.replace('/acceso/completar');
      }
    }
  }, [patientId, isClosing, isProfileComplete, segments]);

  return (
    <View style={{ flex: 1 }}>
      {segments[0] !== 'visor-infografia' && segments[0] !== 'reportes' ? (
        <GlobalStatusNotice />
      ) : null}
      <StatusBar
        barStyle={
          segments[0] === 'visor-infografia' || theme.colorScheme === 'dark'
            ? 'light-content'
            : 'dark-content'
        }
        backgroundColor={Platform.OS === 'android' ? 'transparent' : undefined}
        translucent
      />
      <Stack screenOptions={{ headerShown: false, orientation: 'portrait' }}>
        <Stack.Protected guard={Boolean(patientId && !isClosing && isProfileComplete)}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="visor-infografia"
            options={{ presentation: 'fullScreenModal', headerShown: false, orientation: 'all' }}
          />
          <Stack.Screen name="reportes" options={{ headerShown: false, orientation: 'all' }} />
          <Stack.Screen name="educacion" options={{ headerShown: false }} />
          <Stack.Screen name="perfil" />
          <Stack.Screen name="recordatorios" />
          <Stack.Screen name="asistente" />
          <Stack.Screen name="avisos" />
          <Stack.Screen name="vitales" />
          <Stack.Screen name="formulario" />
        </Stack.Protected>
        <Stack.Screen name="acceso" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </View>
  );
}
