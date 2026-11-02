import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MascotHero } from '../../components/MascotAvatar';
import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  InfoCard,
  ProgressBar,
  SectionTitle,
  StatusPill,
  VisualButton,
  VisualField,
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
          <StatusPill>{demoMode ? 'Demostración' : 'Cuenta institucional'}</StatusPill>
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
          <VisualButton label="Continuar con Google · No disponible" disabled />
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

export function RegisterScreen() {
  const [values, setValues] = useState({ name: '', surname: '', email: '', password: '' });
  return (
    <Screen title="Crear cuenta">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Registro de usuarios</SectionTitle>
        <BodyText>
          El registro de cuentas centrales no está configurado en este entorno. Puedes revisar los
          términos y consentimientos disponibles o seleccionar un paciente de prueba en modo
          demostración.
        </BodyText>
      </InfoCard>
      {isDemoMode() ? (
        <VisualButton
          label="Seleccionar paciente de prueba"
          onPress={() => router.push('/acceso/seleccionar-paciente')}
        />
      ) : null}
      <VisualField
        label="Nombre (deshabilitado · sin servicio central)"
        value={values.name}
        onChangeText={(name) => setValues({ ...values, name })}
        placeholder="No configurado"
        editable={false}
      />
      <VisualField
        label="Apellido (deshabilitado · sin servicio central)"
        value={values.surname}
        onChangeText={(surname) => setValues({ ...values, surname })}
        placeholder="No configurado"
        editable={false}
      />
      <VisualField
        label="Correo electrónico (deshabilitado · sin servicio central)"
        value={values.email}
        onChangeText={(email) => setValues({ ...values, email })}
        keyboardType="email-address"
        placeholder="No configurado"
        editable={false}
      />
      <VisualField
        label="Contraseña (deshabilitado · sin servicio central)"
        value={values.password}
        onChangeText={(password) => setValues({ ...values, password })}
        secureTextEntry
        placeholder="No configurado"
        editable={false}
      />
      <VisualButton
        label="Ver consentimientos"
        onPress={() => router.push('/acceso/consentimientos')}
      />
      <VisualButton label="Registrarse · No configurado" secondary disabled />
    </Screen>
  );
}

export { OnlineConsentScreen as AccessConsentScreen } from './SessionScreens';

export function RecoverScreen() {
  const [email, setEmail] = useState('');
  return (
    <Screen title="Olvidé mi contraseña">
      <DemoBadge />
      <ProgressBar progress={33} />
      <BodyText>Paso 1 de 3 · Ingresa tu correo</BodyText>
      <InfoCard>
        <BodyText>
          La recuperación de contraseña no está disponible. Usa Google para entrar.
        </BodyText>
      </InfoCard>
      <VisualField
        label="Correo electrónico (deshabilitado · sin servicio central)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="No configurado"
        editable={false}
      />
      <VisualButton label="Enviar enlace · No configurado" disabled />
      <VisualButton
        label="Ver estado de correo enviado"
        secondary
        onPress={() => router.push('/acceso/correo')}
      />
    </Screen>
  );
}

export function MailSentScreen() {
  return (
    <Screen title="Revisa tu correo">
      <DemoBadge />
      <ProgressBar progress={66} />
      <BodyText>Paso 2 de 3 · Vista de ejemplo</BodyText>
      <InfoCard>
        <BodyText>
          Cuando el flujo de identidad esté conectado, aquí se explicará cómo usar el enlace
          recibido.
        </BodyText>
      </InfoCard>
      <VisualButton label="Reenviar correo · No configurado" disabled />
      <VisualButton
        label="Ver nueva contraseña"
        secondary
        onPress={() => router.push('/acceso/nueva-clave')}
      />
    </Screen>
  );
}

export function NewPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <Screen title="Nueva contraseña">
      <DemoBadge />
      <ProgressBar progress={100} />
      <BodyText>Paso 3 de 3 · Vista de ejemplo</BodyText>
      <InfoCard>
        <BodyText>
          La validación y actualización de la contraseña se incorporarán con autenticación central.
        </BodyText>
      </InfoCard>
      <VisualField
        label="Nueva contraseña (deshabilitado · sin servicio central)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="No configurado"
        editable={false}
      />
      <VisualField
        label="Confirmar contraseña (deshabilitado · sin servicio central)"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        placeholder="No configurado"
        editable={false}
      />
      <VisualButton label="Actualizar contraseña · No configurado" disabled />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
});
