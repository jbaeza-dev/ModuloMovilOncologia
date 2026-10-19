import { Redirect, useLocalSearchParams } from 'expo-router';

export default function LegacyVisorRedirect() {
  const params = useLocalSearchParams<{ recurso?: string }>();
  return (
    <Redirect
      href={{
        pathname: '/visor-infografia',
        params: params.recurso ? { recurso: params.recurso } : {},
      }}
    />
  );
}
