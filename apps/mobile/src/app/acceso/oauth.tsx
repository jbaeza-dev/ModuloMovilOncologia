import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { BodyText, VisualButton } from '../../components/Visual';
import { useIdentity } from '../../features/access/SessionScreens';

export default function OAuthReturn() {
  const { data, session, snapshot } = useIdentity();
  const [timedOut, setTimedOut] = useState(false);
  const checking = ['authenticating', 'reauthenticating', 'renewing'].includes(snapshot.state);

  useEffect(() => {
    if (data?.patientId) router.replace('/(tabs)');
  }, [data?.patientId]);

  useEffect(() => {
    if (!checking) return;
    const timer = setTimeout(() => setTimedOut(true), 30000);
    return () => clearTimeout(timer);
  }, [checking]);

  const waiting = checking && !timedOut;
  return (
    <Screen title={waiting ? 'Comprobando acceso' : 'Estado del acceso'}>
      <BodyText>
        {waiting
          ? 'Finalizando el acceso con el proveedor central…'
          : timedOut
            ? 'La comprobación está tardando demasiado. Revisa la conexión y vuelve a intentar.'
            : (snapshot.message ?? 'No se pudo completar el acceso. Vuelve a iniciar sesión.')}
      </BodyText>
      {!waiting ? (
        <VisualButton
          label="Volver al acceso"
          onPress={() => {
            session?.cancelRequests();
            router.replace('/acceso');
          }}
        />
      ) : null}
    </Screen>
  );
}
