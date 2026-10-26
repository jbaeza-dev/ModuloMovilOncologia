import { lazy, Suspense } from 'react';
import { Redirect } from 'expo-router';
import { Text } from 'react-native';

const P01Probe = lazy(() => import('../features/preview/p01/P01ProbeScreen'));

export default function P01DiagnosticRoute() {
  if (process.env.EXPO_PUBLIC_P01_PROBE_ENABLED !== 'true') return <Redirect href="/acceso" />;
  return (
    <Suspense fallback={<Text>Cargando diagnóstico nativo…</Text>}>
      <P01Probe />
    </Suspense>
  );
}
