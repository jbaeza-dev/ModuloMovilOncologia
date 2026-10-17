import Feather from '@expo/vector-icons/Feather';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  type ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

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
  const { fontScale, height } = useWindowDimensions();

  const controller = useMemo(() => {
    if (contextController) return contextController;
    const adapter = isDemoMode() ? new FakeAssistantAdapter() : new UnconfiguredAssistantAdapter();
    return new AssistantController(
      adapter,
      patientId,
      () => {
        void closeActiveContext?.('session_required');
      },
      () => Crypto.randomUUID(),
    );
  }, [contextController, patientId, closeActiveContext]);

  const [state, setState] = useState(controller.getState());
  const [messages, setMessages] = useState(controller.getMessages());
  const [isConfigured, setIsConfigured] = useState(controller.isConfigured);
  const [input, setInput] = useState('');
  const [hasNewUnreadResponse, setHasNewUnreadResponse] = useState(false);
  const [latestAnnouncement, setLatestAnnouncement] = useState('');

  const scrollRef = useRef<ScrollView | null>(null);
  const isNearBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(messages.length);

  useEffect(() => {
    setState(controller.getState());
    setMessages(controller.getMessages());
    setIsConfigured(controller.isConfigured);
    const unsubscribe = controller.subscribe(() => {
      setState(controller.getState());
      setMessages(controller.getMessages());
      setIsConfigured(controller.isConfigured);
    });
    return () => {
      unsubscribe();
      if (controller.getState() === 'sending') {
        controller.abort();
      }
    };
  }, [controller]);

  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.sender === 'assistant') {
        setLatestAnnouncement(`Nueva respuesta del asistente recibida.`);
        if (isNearBottomRef.current) {
          setTimeout(() => {
            scrollRef.current?.scrollToEnd({ animated: true });
          }, 100);
        } else {
          setHasNewUnreadResponse(true);
        }
      } else if (lastMsg && lastMsg.sender === 'user') {
        setTimeout(() => {
          scrollRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 80;
    const isClose =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
    isNearBottomRef.current = isClose;
    if (isClose && hasNewUnreadResponse) {
      setHasNewUnreadResponse(false);
    }
  };

  const handleScrollToBottom = () => {
    scrollRef.current?.scrollToEnd({ animated: true });
    setHasNewUnreadResponse(false);
    isNearBottomRef.current = true;
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.navigate('/');
    }
  };

  const isSending = state === 'sending';
  const canSend = !isSending && input.trim().length > 0 && input.length <= 2000;

  const handleSend = () => {
    if (!canSend) return;
    const textToSend = input;
    setInput('');
    void controller.send(textToSend);
  };

  const handleCancel = () => {
    const lastText = controller.getLastSubmittedText();
    controller.abort();
    if (lastText) {
      setInput(lastText);
    }
  };

  const handleRetry = () => {
    const lastText = controller.getLastSubmittedText();
    if (lastText) {
      void controller.send(lastText, true);
    }
  };

  if (!isConfigured || state === 'not_configured') {
    return (
      <Screen title="Asistente QuimioCare">
        <DemoBadge />
        <InfoCard>
          <SectionTitle>Servicio no configurado</SectionTitle>
          <BodyText>
            El servicio del asistente central no está configurado en este entorno. No es posible
            enviar consultas en este momento.
          </BodyText>
          <VisualButton label="Volver" secondary onPress={handleBack} />
        </InfoCard>
      </Screen>
    );
  }

  const isNearLimit = input.length >= 1800;
  const isAtLimit = input.length >= 2000;
  const useScrollableInput = fontScale > 1.3 || height < 500;

  const newResponseChip = hasNewUnreadResponse ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Nueva respuesta del asistente. Pulsa para ir al final"
      onPress={handleScrollToBottom}
      style={({ pressed }) => [styles.newResponseChip, pressed && styles.pressed]}
    >
      <Feather name="arrow-down" size={16} color={appTheme.colors.onPrimary} />
      <Text style={styles.newResponseText}>Nueva respuesta</Text>
    </Pressable>
  ) : null;

  const inputSection = (
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
        <Text
          style={[
            styles.counterText,
            isNearLimit && styles.counterTextWarning,
            isAtLimit && styles.counterTextLimit,
          ]}
        >
          {`${input.length} / 2000`}
          {isNearLimit ? ' (límite cercano)' : ''}
        </Text>
      </View>
      <VisualButton label="Enviar consulta" disabled={!canSend} onPress={handleSend} />
      <BodyText style={styles.disclaimerText}>
        La conversación se conserva temporalmente en memoria durante la sesión y no se registra en
        el almacenamiento permanente.
      </BodyText>
    </View>
  );

  return (
    <Screen
      title="Asistente QuimioCare"
      scrollRef={scrollRef}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      bottomAction={
        !useScrollableInput ? (
          <>
            {newResponseChip}
            {inputSection}
          </>
        ) : undefined
      }
    >
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
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const senderLabel = isUser ? 'Tú' : 'Asistente';
            return (
              <View
                key={msg.id}
                style={[
                  styles.bubbleWrapper,
                  isUser ? styles.userWrapper : styles.assistantWrapper,
                ]}
                accessible={true}
                accessibilityRole="text"
                accessibilityLabel={`${senderLabel}: ${msg.text}`}
              >
                <Text
                  style={isUser ? styles.userBubble : styles.assistantBubble}
                  accessible={false}
                >
                  {msg.text}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {latestAnnouncement ? (
        <View accessibilityLiveRegion="polite" style={styles.srOnly}>
          <Text style={styles.srOnlyText}>{latestAnnouncement}</Text>
        </View>
      ) : null}

      {isSending ? (
        <InfoCard>
          <View
            accessibilityLiveRegion="polite"
            accessibilityLabel="Procesando demostración"
            style={styles.sendingRow}
          >
            <Text style={styles.sendingText}>Procesando demostración…</Text>
            <VisualButton label="Cancelar" secondary onPress={handleCancel} />
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
      ) : state === 'error' ? (
        <InfoCard>
          <SectionTitle>No se pudo procesar</SectionTitle>
          <BodyText>
            Ocurrió un error inesperado al procesar tu consulta. Puedes intentar nuevamente.
          </BodyText>
          <VisualButton label="Reintentar consulta" onPress={handleRetry} />
        </InfoCard>
      ) : null}

      {useScrollableInput ? (
        <>
          {newResponseChip}
          {inputSection}
        </>
      ) : null}
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
      marginTop: theme.spacing.xs,
    },
    counterRow: {
      alignItems: 'flex-end',
      paddingHorizontal: theme.spacing.xs,
    },
    counterText: {
      fontSize: 12,
      color: colors.secondary,
    },
    counterTextWarning: {
      color: colors.error,
      fontWeight: '700',
    },
    counterTextLimit: {
      color: colors.error,
      fontWeight: '800',
    },
    disclaimerText: {
      fontSize: 12,
      color: colors.secondary,
      textAlign: 'center',
      marginTop: theme.spacing.xs,
    },
    newResponseChip: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: 24,
      minHeight: 48,
      minWidth: 48,
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
      elevation: 2,
    },
    newResponseText: {
      color: colors.onPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    pressed: {
      opacity: 0.8,
    },
    srOnly: {
      position: 'absolute',
      width: 1,
      height: 1,
      padding: 0,
      margin: -1,
      overflow: 'hidden',
    },
    srOnlyText: {
      fontSize: 1,
      color: 'transparent',
    },
  });
}
