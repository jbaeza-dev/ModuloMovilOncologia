import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text } from 'react-native';
import { AppIcon as Feather } from '../../components/AppIcon';

/** Tiempo que la confirmación queda a la vista si el paciente no la toca. */
export const SUBMISSION_SUCCESS_MS = 4000;

/**
 * Confirmación del cuestionario enviado. Se cierra sola tras unos segundos o al tocarla;
 * `onDone` se llama una sola vez aunque coincidan el toque, el botón atrás y el tiempo.
 */
export function SubmissionSuccessModal({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!visible) return;
    done.current = false;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
    const timer = setTimeout(close, SUBMISSION_SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  function close() {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable
        testID="confirmacion-cuestionario"
        style={styles.overlay}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Cerrar confirmación"
      >
        <Animated.View
          style={[
            styles.card,
            {
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
              ],
            },
          ]}
          accessibilityViewIsModal
          accessibilityLiveRegion="polite"
        >
          <Feather name="check-circle" size={48} color="#2e7d32" />
          <Text style={styles.title}>¡Cuestionario enviado!</Text>
          <Text style={styles.message}>
            Tus respuestas fueron registradas y guardadas exitosamente.
          </Text>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 22,
  },
});
