import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  EmptyState,
  InfoCard,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

export function AssistantScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { estado } = useLocalSearchParams<{ estado?: string }>();
  const [message, setMessage] = useState('');
  const state =
    estado === 'espera' || estado === 'error' || estado === 'sin-conexion' ? estado : 'inicio';
  return (
    <Screen title="Asistente QuimioCare" backTo="/">
      <DemoBadge />
      <InfoCard>
        <BodyText>
          Este asistente ofrece orientación general. No diagnostica, prescribe ni sustituye a tu
          equipo de salud.
        </BodyText>
      </InfoCard>
      {state === 'inicio' ? (
        <View style={styles.chat}>
          <Text style={styles.assistantBubble}>
            Hola. Este es un ejemplo de conversación temporal.
          </Text>
          <Text style={styles.userBubble}>Mensaje de ejemplo.</Text>
          <Text style={styles.assistantBubble}>Respuesta ficticia para revisar la interfaz.</Text>
        </View>
      ) : state === 'espera' ? (
        <EmptyState
          icon="clock"
          title="Esperando respuesta"
          description="Estado de espera de ejemplo. No se envió ningún mensaje."
        />
      ) : state === 'sin-conexion' ? (
        <EmptyState
          icon="wifi-off"
          title="Sin conexión"
          description="Estado de ejemplo. No se comprueba la conectividad."
        />
      ) : (
        <EmptyState
          icon="alert-circle"
          title="No se pudo responder"
          description="Estado de error de ejemplo. No se consultó ningún servicio."
        />
      )}
      <VisualField
        label="Escribe tu consulta"
        value={message}
        onChangeText={setMessage}
        placeholder="Escribe aquí..."
      />
      <VisualButton label="Enviar · disponible más adelante" />
      <BodyText>La conversación no se guarda ni se envía.</BodyText>
    </Screen>
  );
}
function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    chat: { gap: theme.spacing.md },
    assistantBubble: {
      alignSelf: 'flex-start',
      maxWidth: '82%',
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 15,
      lineHeight: 23,
    },
    userBubble: {
      alignSelf: 'flex-end',
      maxWidth: '82%',
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: colors.primaryContainer,
      color: colors.onPrimaryContainer,
      fontSize: 15,
      lineHeight: 23,
    },
  });
}
