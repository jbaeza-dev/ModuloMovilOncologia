import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { MascotHero } from '../../components/MascotAvatar';
import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { isDemoMode } from '../../utils/environment';
import { theme } from '../../theme';
import { useIdentity } from './SessionScreens';

export function LoginScreen() {
  const { session, data, snapshot } = useIdentity();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const demoMode = isDemoMode() || session?.config.mode === 'demo';
  const isOAuthConfigured =
    session?.config.mode === 'production' || session?.config.mode === 'universidad-demo';

  return (
    <Screen isRoot>
      <MascotHero
        pose="saludo"
        eyebrow="QUIMIOCARE · CONTIGO EN CASA"
        title="Te damos la bienvenida."
        description="Anota tus signos vitales, responde cómo te sientes y consulta las guías de cuidado preparadas para tu tratamiento."
        centered
      />

      <DemoBadge />

      {snapshot.state === 'closing' && snapshot.user && !data?.patientId ? (
        <InfoCard>
          <SectionTitle>Cerrando la sesión anterior</SectionTitle>
          <BodyText>
            Estamos limpiando los datos temporales del teléfono antes de abrir otra cuenta.
          </BodyText>
          <VisualButton
            label="Reintentar cierre anterior"
            disabled={data?.isClosing}
            onPress={() => {
              void data
                ?.closeActiveContext('manual_close')
                .then((result) =>
                  setFeedback(
                    result.success
                      ? 'Sesión anterior cerrada.'
                      : (result.error ?? 'No se pudo completar el cierre.'),
                  ),
                );
            }}
          />
        </InfoCard>
      ) : null}

      <InfoCard>
        <View style={styles.cardHeaderRow}>
          <SectionTitle>
            {demoMode ? 'Demostración con datos de prueba' : 'Ingresa a tu cuenta'}
          </SectionTitle>
          {demoMode ? <StatusPill>Demostración</StatusPill> : null}
        </View>
        <BodyText>
          {demoMode
            ? 'Este teléfono está en modo demostración con datos ficticios. Tus registros de prueba quedan separados de las cuentas reales.'
            : isOAuthConfigured
              ? 'Usa el correo asociado a tu atención en el centro de salud. Se abrirá una ventana segura de Google para confirmar tu identidad.'
              : 'El servicio de acceso institucional no está disponible en este momento. Puedes revisar los términos informados mientras se restablece.'}
        </BodyText>

        {feedback ? <BodyText>{feedback}</BodyText> : null}

        {demoMode ? (
          <VisualButton
            label="Seleccionar paciente de prueba"
            onPress={() => router.push('/acceso/seleccionar-paciente')}
          />
        ) : isOAuthConfigured ? (
          <VisualButton
            label={busy ? 'Abriendo acceso seguro…' : 'Continuar con Google'}
            icon={<FontAwesome name="google" size={18} color="#FFFFFF" />}
            disabled={busy || !data}
            onPress={() => {
              setBusy(true);
              void data?.manager
                .authenticate()
                .catch((e) => setFeedback(e instanceof Error ? e.message : 'No se pudo acceder.'))
                .finally(() => setBusy(false));
            }}
          />
        ) : (
          <VisualButton
            label="Continuar con Google · No disponible"
            icon={<FontAwesome name="google" size={18} color="#FFFFFF" />}
            disabled
          />
        )}
      </InfoCard>

      <NavigationCard
        title="Términos y consentimiento informado"
        description="Conoce cómo cuidamos tu información médica antes de ingresar."
        icon="shield"
        href="/acceso/consentimientos"
      />
    </Screen>
  );
}

export { OnlineConsentScreen as AccessConsentScreen } from './SessionScreens';

const styles = StyleSheet.create({
  cardHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
});
