import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  InfoCard,
  ProgressBar,
  SectionTitle,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { useIdentity } from './SessionScreens';
import { isDemoMode } from '../../utils/environment';

function AccessIntro({ subtitle }: { subtitle: string }) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  return (
    <View style={styles.intro}>
      <Text style={styles.logo}>Q</Text>
      <Text style={styles.brand}>QuimioCare</Text>
      <BodyText>{subtitle}</BodyText>
    </View>
  );
}

export function LoginScreen() {
  const { session, data, snapshot } = useIdentity();
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Screen>
      <AccessIntro subtitle="Acompañamiento durante tu quimioterapia." />
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Servicios de acceso</SectionTitle>
        <BodyText>
          {session?.config.mode === 'demo'
            ? 'Accede con una cuenta sintética del simulador. Sus datos locales se conservan al cerrar sesión.'
            : session
              ? 'Accede con Google mediante el proveedor central.'
              : 'El proveedor de autenticación no está configurado. Las cuentas de prueba requieren configurar el simulador.'}
        </BodyText>
      </InfoCard>
      {isDemoMode() ? (
        <VisualButton
          label="Seleccionar paciente de prueba"
          onPress={() => router.navigate('/acceso/seleccionar-paciente')}
        />
      ) : null}
      <VisualField
        label="Correo electrónico (deshabilitado · sin servicio central)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="Autenticación central no configurada"
        editable={false}
      />
      <VisualField
        label="Contraseña (deshabilitado · sin servicio central)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Autenticación central no configurada"
        editable={false}
      />
      {feedback ? <BodyText>{feedback}</BodyText> : null}
      {snapshot.state === 'closing' && snapshot.user && !data?.patientId ? (
        <InfoCard>
          <BodyText>
            El cierre anterior no se ha completado. Reintenta antes de entrar con otra cuenta.
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
      {session?.config.mode === 'production' || session?.config.mode === 'universidad-demo' ? (
        <VisualButton
          label="Continuar con Google"
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
        <VisualButton label="Iniciar sesión · No configurado" disabled />
      )}
      <VisualButton
        label="¿Olvidaste tu contraseña?"
        secondary
        onPress={() => router.navigate('/acceso/recuperar')}
      />
      <VisualButton
        label="Crear cuenta nueva"
        secondary
        onPress={() => router.navigate('/acceso/registro')}
      />
      <VisualButton
        label="Ver términos y consentimientos"
        secondary
        onPress={() => router.navigate('/acceso/consentimientos')}
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
          onPress={() => router.navigate('/acceso/seleccionar-paciente')}
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
        onPress={() => router.navigate('/acceso/consentimientos')}
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
          La recuperación remota de contraseña no está conectada en esta versión local.
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
        onPress={() => router.navigate('/acceso/correo')}
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
        onPress={() => router.navigate('/acceso/nueva-clave')}
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

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    intro: { alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.lg },
    logo: {
      width: 72,
      height: 72,
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: colors.primaryContainer,
      textAlign: 'center',
      textAlignVertical: 'center',
      fontSize: 34,
      fontWeight: '700',
      color: colors.primary,
    },
    brand: { fontSize: 28, fontWeight: '700', color: colors.primary },
    termHeader: {
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    contentBox: {
      backgroundColor: colors.surface,
      padding: theme.spacing.md,
      borderRadius: theme.radius.sm,
      marginVertical: theme.spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    contentText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    statusRow: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    hintText: {
      fontSize: 13,
      color: colors.secondary,
      marginVertical: 4,
    },
    feedbackText: {
      color: colors.primary,
      fontWeight: '600',
    },
  });
}
