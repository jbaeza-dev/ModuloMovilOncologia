import { MascotAvatar } from '../../components/MascotAvatar';
import { AppIcon as Feather } from '../../components/AppIcon';
import * as Crypto from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  type ScrollView,
  StyleSheet,
  Text,
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
import { UnconfiguredAssistantAdapter } from '../../services/assistant/unconfigured-assistant-adapter';
import { theme } from '../../theme';

function TypingDots() {
  const { theme: appTheme } = useAppTheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const anim1 = useRef(new Animated.Value(0.3)).current;
  const anim2 = useRef(new Animated.Value(0.3)).current;
  const anim3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      anim1.setValue(1);
      anim2.setValue(1);
      anim3.setValue(1);
      return;
    }
    const createPulse = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.delay(Math.max(0, 400 - delay)),
        ]),
      );
    };

    const loop1 = createPulse(anim1, 0);
    const loop2 = createPulse(anim2, 180);
    const loop3 = createPulse(anim3, 360);

    loop1.start();
    loop2.start();
    loop3.start();

    return () => {
      loop1.stop();
      loop2.stop();
      loop3.stop();
    };
  }, [reduceMotion, anim1, anim2, anim3]);

  return (
    <View
      style={typingStyles.container}
      accessibilityRole="progressbar"
      accessibilityLabel="El asistente está escribiendo una respuesta"
    >
      <Animated.View
        style={[typingStyles.dot, { backgroundColor: appTheme.colors.text, opacity: anim1 }]}
      />
      <Animated.View
        style={[typingStyles.dot, { backgroundColor: appTheme.colors.text, opacity: anim2 }]}
      />
      <Animated.View
        style={[typingStyles.dot, { backgroundColor: appTheme.colors.text, opacity: anim3 }]}
      />
    </View>
  );
}

const typingStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export function AssistantScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { patientId, assistantController: contextController, closeActiveContext } = useLocalData();

  const controller = useMemo(() => {
    if (contextController) return contextController;
    const adapter = new UnconfiguredAssistantAdapter();
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
  const lastAssistantMsgIdRef = useRef<string | null>(
    messages
      .slice()
      .reverse()
      .find((m) => m.sender === 'assistant')?.id ?? null,
  );
  const lastUserMsgIdRef = useRef<string | null>(
    messages
      .slice()
      .reverse()
      .find((m) => m.sender === 'user')?.id ?? null,
  );
  const responseCounterRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
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
        controller.closeConversation();
        setState('idle');
        setMessages([]);
        setInput('');
        setLatestAnnouncement('');
        setHasNewUnreadResponse(false);
        lastAssistantMsgIdRef.current = null;
        lastUserMsgIdRef.current = null;
      };
    }, [controller, patientId]),
  );

  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return;

    if (lastMsg.sender === 'assistant' && lastMsg.id !== lastAssistantMsgIdRef.current) {
      lastAssistantMsgIdRef.current = lastMsg.id;
      responseCounterRef.current += 1;
      const snippet = lastMsg.text.length > 50 ? `${lastMsg.text.slice(0, 50)}…` : lastMsg.text;
      setLatestAnnouncement(
        `Nueva respuesta del asistente (#${responseCounterRef.current}): ${snippet}`,
      );
      if (isNearBottomRef.current) {
        setTimeout(() => {
          scrollRef.current?.scrollToEnd({ animated: true });
        }, 100);
      } else {
        setHasNewUnreadResponse(true);
      }
    } else if (lastMsg.sender === 'user' && lastMsg.id !== lastUserMsgIdRef.current) {
      lastUserMsgIdRef.current = lastMsg.id;
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
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
      router.replace('/');
    }
  };

  const isSending = state === 'sending';
  const characterCount = Array.from(input).length;
  const canSend = !isSending && input.trim().length > 0 && characterCount <= 2000;
  const fixedHeader = (
    <View style={styles.scopeNotice}>
      <MascotAvatar pose="explicacion" size="md" framed={false} />
      <View style={styles.scopeCopy}>
        <Text accessibilityRole="header" style={styles.scopeTitle}>
          Asistente QuimioCare
        </Text>
        <Text style={styles.scopeText}>
          Orientación educativa. No reemplaza a tu equipo de salud.
        </Text>
      </View>
    </View>
  );

  const handleSend = () => {
    if (!canSend) return;
    const textToSend = input;
    setInput('');
    void controller.send(textToSend);
  };

  const handleRetry = () => {
    const lastText = controller.getLastSubmittedText();
    if (lastText) {
      void controller.send(lastText, true);
    }
  };

  if (!isConfigured || state === 'not_configured') {
    return (
      <Screen fixedHeader={fixedHeader}>
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

  const isNearLimit = characterCount >= 1800;
  const isAtLimit = characterCount >= 2000;

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
        maxLength={4000}
      />
      <View style={styles.counterRow}>
        <Text
          style={[
            styles.counterText,
            isNearLimit && styles.counterTextWarning,
            isAtLimit && styles.counterTextLimit,
          ]}
        >
          {`${characterCount} / 2000`}
          {isNearLimit ? ' (límite cercano)' : ''}
        </Text>
      </View>
      {characterCount > 2000 ? (
        <Text accessibilityRole="alert" style={styles.counterTextLimit}>
          Reduce la consulta a un máximo de 2000 caracteres.
        </Text>
      ) : null}
      <VisualButton label="Enviar consulta" disabled={!canSend} onPress={handleSend} />
      <BodyText style={styles.disclaimerText}>
        La conversación se borra al cerrar la sesión.
      </BodyText>
    </View>
  );

  return (
    <Screen
      fixedHeader={fixedHeader}
      scrollRef={scrollRef}
      onScroll={handleScroll}
      scrollEventThrottle={16}
    >
      <DemoBadge />

      {messages.length === 0 && !isSending ? (
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
              >
                {!isUser ? <MascotAvatar pose="explicacion" size="sm" framed={false} /> : null}
                <Text
                  style={isUser ? styles.userBubble : styles.assistantBubble}
                  accessibilityLabel={`${senderLabel}: ${msg.text}`}
                >
                  {msg.text}
                </Text>
                {msg.response ? (
                  <View style={styles.responseMetadata}>
                    <Text
                      style={styles.metadataText}
                    >{`Estado: ${responseStateLabel(msg.response.estado_respuesta)}. Confianza informada: ${formatConfidenceLabel(msg.response.confianza_nivel)}.`}</Text>
                    <Text style={styles.metadataText}>
                      {msg.response.fuentes.length
                        ? `Fuentes: ${msg.response.fuentes.map((source) => `${source.tema} (guía ${source.guia})`).join(' · ')}`
                        : 'Sin fuentes informadas.'}
                    </Text>
                    {msg.response.requiere_urgencia ? (
                      <View
                        accessible
                        accessibilityRole="alert"
                        accessibilityLiveRegion="assertive"
                        style={styles.urgencyNotice}
                      >
                        <Text style={styles.urgencyText}>
                          Busca ayuda urgente. No esperes a la app: QuimioCare no ha avisado a
                          profesionales.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
          {isSending ? (
            <View
              style={[styles.bubbleWrapper, styles.assistantWrapper]}
              accessibilityLiveRegion="polite"
              accessibilityLabel="El asistente está escribiendo una respuesta"
            >
              <MascotAvatar pose="explicacion" size="sm" framed={false} />
              <View style={[styles.assistantBubble, styles.typingBubble]}>
                <TypingDots />
              </View>
            </View>
          ) : null}
        </View>
      )}

      {latestAnnouncement ? (
        <View accessibilityLiveRegion="polite" style={styles.srOnly}>
          <Text style={styles.srOnlyText}>{latestAnnouncement}</Text>
        </View>
      ) : null}

      {state === 'offline' ? (
        <InfoCard>
          <SectionTitle>Sin conexión</SectionTitle>
          <BodyText>
            No se pudo conectar con el servicio del asistente. El texto permanece solo en memoria
            mientras sigas en este chat.
          </BodyText>
          <VisualButton label="Reintentar consulta" onPress={handleRetry} />
        </InfoCard>
      ) : state === 'timeout' ? (
        <InfoCard>
          <SectionTitle>Tiempo de espera superado</SectionTitle>
          <BodyText>
            No se obtuvo una respuesta dentro del tiempo de espera. El servicio podría haber
            procesado la consulta. Puedes decidir si reintentas.
          </BodyText>
          <VisualButton label="Reintentar consulta" onPress={handleRetry} />
        </InfoCard>
      ) : state === 'cancelled' ? (
        <InfoCard>
          <SectionTitle>Consulta cancelada</SectionTitle>
          <BodyText>
            Dejaste de esperar la respuesta. El servicio podría seguir procesando la consulta.
          </BodyText>
        </InfoCard>
      ) : state === 'unavailable' ? (
        <InfoCard>
          <SectionTitle>Asistente no disponible</SectionTitle>
          <BodyText>El servicio no tiene una respuesta disponible en este momento.</BodyText>
          <VisualButton label="Reintentar consulta" onPress={handleRetry} />
        </InfoCard>
      ) : state === 'error' ? (
        <InfoCard>
          <SectionTitle>No se pudo procesar</SectionTitle>
          <BodyText>
            {serviceDetail(controller.getLastFailure()?.body) ??
              'No fue posible procesar la consulta. Puedes decidir si reintentas.'}
          </BodyText>
          <VisualButton label="Reintentar consulta" onPress={handleRetry} />
        </InfoCard>
      ) : null}

      {newResponseChip}
      {inputSection}
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    scopeNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.sm,
      backgroundColor: colors.background,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    scopeCopy: { flex: 1, minWidth: 0 },
    scopeTitle: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '700',
      color: colors.text,
      marginBottom: theme.spacing.xs,
    },
    scopeText: { fontSize: 14, lineHeight: 20, color: colors.text },
    responseMetadata: { gap: theme.spacing.xs, marginTop: theme.spacing.xs, maxWidth: '100%' },
    metadataText: { fontSize: 13, lineHeight: 19, color: colors.secondary },
    urgencyNotice: {
      padding: theme.spacing.sm,
      borderColor: colors.error,
      borderWidth: 1,
      borderRadius: theme.radius.md,
    },
    urgencyText: { color: colors.error, fontSize: 14, lineHeight: 20 },
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
    typingBubble: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      minHeight: 38,
      justifyContent: 'center',
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
function formatConfidenceLabel(level: string): string {
  return (level ?? '').replace(/_/g, ' ');
}

function responseStateLabel(state: string): string {
  return (
    (
      {
        respuesta: 'respuesta',
        sin_informacion: 'sin información suficiente',
        cortesia: 'cortesía',
        no_disponible: 'no disponible',
        no_verificada: 'no verificada',
      } as Record<string, string>
    )[state] ?? (state ?? '').replace(/_/g, ' ')
  );
}
function serviceDetail(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (typeof value.detail === 'string') return value.detail;
  if (
    value.error &&
    typeof value.error === 'object' &&
    'mensaje' in value.error &&
    typeof value.error.mensaje === 'string'
  )
    return value.error.mensaje;
  return null;
}
