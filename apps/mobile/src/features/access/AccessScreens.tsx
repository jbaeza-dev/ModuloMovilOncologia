import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  ChoiceChip,
  DemoBadge,
  InfoCard,
  ProgressBar,
  SectionTitle,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { theme } from '../../theme';

function AccessIntro({ subtitle }: { subtitle: string }) {
  return (
    <View style={styles.intro}>
      <Text style={styles.logo}>Q</Text>
      <Text style={styles.brand}>QuimioCare</Text>
      <BodyText>{subtitle}</BodyText>
    </View>
  );
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Screen backTo="/">
      <AccessIntro subtitle="Acompañamiento durante tu quimioterapia." />
      <DemoBadge />
      <VisualField
        label="Correo electrónico"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="nombre@ejemplo.cl"
      />
      <VisualField
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Contraseña"
      />
      <VisualButton label="Iniciar sesión · disponible más adelante" />
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
    </Screen>
  );
}

export function RegisterScreen() {
  const [values, setValues] = useState({ name: '', surname: '', email: '', password: '' });
  return (
    <Screen title="Crear cuenta" backTo="/acceso">
      <DemoBadge />
      <VisualField
        label="Nombre"
        value={values.name}
        onChangeText={(name) => setValues({ ...values, name })}
      />
      <VisualField
        label="Apellido"
        value={values.surname}
        onChangeText={(surname) => setValues({ ...values, surname })}
      />
      <VisualField
        label="Correo electrónico"
        value={values.email}
        onChangeText={(email) => setValues({ ...values, email })}
        keyboardType="email-address"
      />
      <VisualField
        label="Contraseña"
        value={values.password}
        onChangeText={(password) => setValues({ ...values, password })}
        secureTextEntry
      />
      <VisualButton
        label="Ver consentimientos"
        onPress={() => router.navigate('/acceso/consentimientos')}
      />
      <VisualButton label="Registrarse · disponible más adelante" secondary />
    </Screen>
  );
}

export function AccessConsentScreen() {
  const [selected, setSelected] = useState(false);
  return (
    <Screen title="Consentimientos" backTo="/acceso/registro">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Antes de comenzar</SectionTitle>
        <BodyText>
          Texto de muestra para revisar la distribución de los consentimientos. El contenido
          definitivo requiere revisión legal y clínica.
        </BodyText>
      </InfoCard>
      <InfoCard>
        <SectionTitle>Consentimiento de ejemplo</SectionTitle>
        <BodyText>
          Se explicará qué datos se utilizan, con qué propósito y cómo se protegen.
        </BodyText>
      </InfoCard>
      <ChoiceChip
        label={selected ? 'Selección visual marcada' : 'Marcar selección visual'}
        selected={selected}
        onPress={() => setSelected(!selected)}
      />
      <VisualButton label="Aceptar y comenzar · disponible más adelante" />
      <BodyText>La selección es temporal y no constituye una aceptación registrada.</BodyText>
    </Screen>
  );
}

export function RecoverScreen() {
  const [email, setEmail] = useState('');
  return (
    <Screen title="Olvidé mi contraseña" backTo="/acceso">
      <DemoBadge />
      <ProgressBar progress={33} />
      <BodyText>Paso 1 de 3 · Ingresa tu correo</BodyText>
      <VisualField
        label="Correo electrónico"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
      />
      <VisualButton label="Enviar enlace · disponible más adelante" />
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
    <Screen title="Revisa tu correo" backTo="/acceso/recuperar">
      <DemoBadge />
      <ProgressBar progress={66} />
      <BodyText>Paso 2 de 3 · Vista de ejemplo</BodyText>
      <InfoCard>
        <BodyText>
          Cuando el flujo de identidad esté conectado, aquí se explicará cómo usar el enlace
          recibido.
        </BodyText>
      </InfoCard>
      <VisualButton label="Reenviar correo · disponible más adelante" />
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
    <Screen title="Nueva contraseña" backTo="/acceso/correo">
      <DemoBadge />
      <ProgressBar progress={100} />
      <BodyText>Paso 3 de 3 · Vista de ejemplo</BodyText>
      <VisualField
        label="Nueva contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <VisualField
        label="Confirmar contraseña"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
      />
      <InfoCard>
        <BodyText>
          La validación y actualización de la contraseña se incorporarán con autenticación.
        </BodyText>
      </InfoCard>
      <VisualButton label="Actualizar contraseña · disponible más adelante" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.lg },
  logo: {
    width: 72,
    height: 72,
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: theme.colors.mutedSurface,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 34,
    fontWeight: '700',
    color: theme.colors.text,
  },
  brand: { fontSize: 28, fontWeight: '700', color: theme.colors.text },
});
