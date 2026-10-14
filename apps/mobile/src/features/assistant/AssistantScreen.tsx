import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  EmptyState,
  InfoCard,
  SectionTitle,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { AssistantController } from '../../services/assistant/assistant-controller';
import { FakeAssistantAdapter } from '../../services/assistant/fake-assistant-adapter';
import { UnconfiguredAssistantAdapter } from '../../services/assistant/unconfigured-assistant-adapter';
import { theme } from '../../theme';
import { isDemoMode } from '../../utils/environment';

export function AssistantScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { patientId, assistantController: contextController, closeActiveContext } = useLocalData();

  const controller = useMemo(() => {
    if (contextController) return contextController;
    const adapter = isDemoMode() ? new FakeAssistantAdapter() : new UnconfiguredAssistantAdapter();
    return new AssistantController(adapter, patientId, () => {
      void closeActiveContext?.('session_required');
    });
  }, [contextController, patientId, closeActiveContext]);

  const [state, setState] = useState(controller.getState());
  const [messages, setMessages] = useState(controller.getMessages());
  const [input, setInput] = useState('');

  useEffect(() => {
    setState(controller.getState());
    setMessages(controller.getMessages());
    return controller.subscribe(() => {
      setState(controller.getState());
      setMessages(controller.getMessages());
    });
  }, [controller]);

  const isSending = state === 'sending';
  const canSend = !isSending && input.trim().length > 0 && input.length <= 2000;

  const handleSend = async () => {
    if (!canSend) return;
    const textToSend = input;
    setInput('');
    await controller.send(textToSend);
  };

  const handleRetry = async () => {
    const lastText = controller.getLastSubmittedText();
    if (lastText) {
      await controller.send(lastText, true);
    }
  };

  return (
    <Screen title="Asistente QuimioCare" backTo="/">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Orientación general</SectionTitle>
        <BodyText>
          Este asistente ofrece orientación general. No diagnostica, prescribe ni sustituye a tu
          equipo de salud.
        </BodyText>
      </InfoCard>

      {messages.length === 0 ? (
        <EmptyState
          icon="message-circle"
          title="Consulta al asistente"
          description="Escribe una pregunta para recibir orientación demostrativa general sobre tu tratamiento."
        />
      ) : (
        <View style={styles.chat}>
          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.bubbleWrapper,
                msg.sender === 'user' ? styles.userWrapper : styles.assistantWrapper,
              ]}
            >
              <Text style={msg.sender === 'user' ? styles.userBubble : styles.assistantBubble}>
                {msg.text}
              </Text>
            </View>
          ))}
        </View>
      )}

      {isSending ? (
        <InfoCard>
          <View
            accessibilityLiveRegion="polite"
            accessibilityLabel="Procesando demostración"
            style={styles.sendingRow}
          >
            <Text style={styles.sendingText}>Procesando demostración…</Text>
            <VisualButton label="Cancelar" secondary onPress={() => controller.abort()} />
          </View>
        </InfoCard>
      ) : state === 'offline' ? (
        <InfoCard>
          <SectionTitle>Sin conexión</SectionTitle>
          <BodyText>
            No se pudo conectar con el servicio del asistente. Tu consulta se conservó en este
            dispositivo.
          </BodyText>
          <VisualButton label="Reintentar consulta" onPress={handleRetry} />
        </InfoCard>
      ) : state === 'timeout' ? (
        <InfoCard>
          <SectionTitle>Tiempo de espera superado</SectionTitle>
          <BodyText>
            La respuesta tardó más de 15 segundos en completarse. Puedes reintentar cuando gustes.
          </BodyText>
          <VisualButton label="Reintentar consulta" onPress={handleRetry} />
        </InfoCard>
      ) : state === 'cancelled' ? (
        <InfoCard>
          <SectionTitle>Consulta cancelada</SectionTitle>
          <BodyText>La consulta en curso fue cancelada por el usuario.</BodyText>
        </InfoCard>
      ) : state === 'not_configured' ? (
        <InfoCard>
          <SectionTitle>Servicio no configurado</SectionTitle>
          <BodyText>
            El servicio del asistente central no está configurado en este entorno.
          </BodyText>
        </InfoCard>
      ) : state === 'error' ? (
        <InfoCard>
          <SectionTitle>No se pudo procesar</SectionTitle>
          <BodyText>
            Ocurrió un error inesperado al procesar tu consulta. Puedes intentar nuevamente.
          </BodyText>
          <VisualButton label="Reintentar consulta" onPress={handleRetry} />
        </InfoCard>
      ) : null}

      <View style={styles.inputSection}>
        <VisualField
          label="Escribe tu consulta"
          value={input}
          onChangeText={setInput}
          placeholder="Escribe aquí tu consulta..."
          multiline
          maxLength={2000}
        />
        <View style={styles.counterRow}>
          <Text style={styles.counterText}>{`${input.length} / 2000`}</Text>
        </View>
        <VisualButton label="Enviar consulta" disabled={!canSend} onPress={handleSend} />
        <BodyText style={styles.disclaimerText}>
          La conversación se conserva temporalmente en memoria durante la sesión y no se registra en
          el almacenamiento permanente.
        </BodyText>
      </View>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    chat: {
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.sm,
    },
    bubbleWrapper: {
      width: '100%',
    },
    userWrapper: {
      alignItems: 'flex-end',
    },
    assistantWrapper: {
      alignItems: 'flex-start',
    },
    assistantBubble: {
      maxWidth: '85%',
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
      borderWidth: 1,
      borderColor: colors.border,
    },
    userBubble: {
      maxWidth: '85%',
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: colors.primaryContainer,
      color: colors.primary,
      fontSize: 15,
      lineHeight: 22,
    },
    sendingRow: {
      gap: theme.spacing.sm,
    },
    sendingText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.primary,
    },
    inputSection: {
      gap: theme.spacing.xs,
      marginTop: theme.spacing.sm,
    },
    counterRow: {
      alignItems: 'flex-end',
      paddingHorizontal: theme.spacing.xs,
    },
    counterText: {
      fontSize: 12,
      color: colors.secondary,
    },
    disclaimerText: {
      fontSize: 12,
      color: colors.secondary,
      textAlign: 'center',
      marginTop: theme.spacing.xs,
    },
  });
}
