import { lazy, Suspense } from 'react';
import { Redirect } from 'expo-router';
import { Text } from 'react-native';
const Probe = lazy(() => import('../features/preview/p07/P07V4ProbeScreen'));
export default function DiagnosticP07V4() {
  if (
    process.env.EXPO_PUBLIC_APP_ENV !== 'demo' ||
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW !== 'true'
  )
    return <Redirect href="/acceso" />;
  return (
    <Suspense fallback={<Text>Preparando laboratorio…</Text>}>
      <Probe />
    </Suspense>
  );
}
