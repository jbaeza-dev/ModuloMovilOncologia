import { Redirect } from 'expo-router';

export default function LegacyCopiesRedirect() {
  return <Redirect href="/educacion?filtro=offline" />;
}
