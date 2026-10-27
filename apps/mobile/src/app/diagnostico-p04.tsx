import { lazy, Suspense } from 'react';
import { Redirect } from 'expo-router';
import { Text } from 'react-native';
const Probe = lazy(() => import('../features/preview/p04/P04ProbeScreen'));
const Acceptance = lazy(() => import('../features/preview/p04/P04AcceptanceScreen'));
export default function DiagnosticP04() {
  if (
    process.env.EXPO_PUBLIC_P04_PROBE_ENABLED !== 'true' ||
    process.env.EXPO_PUBLIC_DEMO_MODE !== 'true'
  )
    return <Redirect href="/acceso" />;
  return (
    <Suspense fallback={<Text>Cargando prueba nativa…</Text>}>
      {process.env.EXPO_PUBLIC_P04_LAB_ONLY === 'true' ? <Probe /> : <Acceptance />}
    </Suspense>
  );
}
