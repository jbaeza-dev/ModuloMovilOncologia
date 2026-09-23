import Feather from '@expo/vector-icons/Feather';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const [loaded, error] = useFonts(Feather.font);
  if (error) throw error;
  if (!loaded) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
