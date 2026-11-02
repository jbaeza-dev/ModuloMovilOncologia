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
    // Si la sesión requiere completar datos personales o términos:
    const identity = (
      snapshot as { identity?: { profile?: { rut?: string }; clinicalStatus?: string } }
    ).identity;
    const consent = (snapshot as { consent?: { requiere_aceptacion?: boolean } }).consent;

    // Solo redirigir a completar si faltan datos personales esenciales del paciente (RUT)
    if (identity && (!identity.profile?.rut || identity.profile.rut.trim().length === 0)) {
      router.replace('/acceso/completar');
      return;
    }

    if (consent?.requiere_aceptacion) {
      router.replace('/acceso/consentimientos');
      return;
    }

    if (data?.patientId) {
      router.replace('/(tabs)');
    }
  }, [data?.patientId, snapshot]);

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
          ? 'Estamos comprobando tu cuenta y preparando tu acceso…'
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
