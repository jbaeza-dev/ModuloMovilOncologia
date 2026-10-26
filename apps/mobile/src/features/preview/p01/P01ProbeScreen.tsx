import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';

import { Screen } from '../../../components/Screen';
import { useAppTheme } from '../../../providers/ThemeProvider';
import { parseProbeUrl, type ProbeOptions } from './probe-options';
import { acquireProbePushToken, NativeP01Probe, type ProbeResult } from './probe-runtime';

export default function P01ProbeScreen() {
  const { theme } = useAppTheme();
  const textStyle = { color: theme.colors.text };
  const probe = useRef<NativeP01Probe | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const [patient, setPatient] = useState<'A' | 'B'>('A');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(
    'Sin inicializar. Solo datos sintéticos; no migra el historial.',
  );
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [pushObserved, setPushObserved] = useState(0);

  useEffect(() => {
    alive.current = true;
    const listener = Notifications.addNotificationReceivedListener((notification) => {
      if (notification.request.content.data?.probe === 'p01' && alive.current) {
        setPushObserved((value) => value + 1);
      }
    });
    return () => {
      alive.current = false;
      listener.remove();
      void probe.current?.close();
    };
  }, []);

  const options = (): ProbeOptions => ({
    patient,
    clinicalUrl: parseProbeUrl(process.env.EXPO_PUBLIC_P01_CLINICAL_URL),
    syncUrl: parseProbeUrl(process.env.EXPO_PUBLIC_P01_POWERSYNC_URL),
  });

  async function run(action: () => Promise<ProbeResult | void>, label: string) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setMessage('En curso: ' + label + '.');
    try {
      const value = await action();
      if (alive.current) {
        if (value) setResult(value);
        setMessage(label + ': completado.');
      }
    } catch (error) {
      if (alive.current)
        setMessage(error instanceof Error ? error.message : 'Falló la prueba nativa.');
    } finally {
      busy.current = false;
      if (alive.current) setWorking(false);
    }
  }

  const initialize = async () => {
    if (probe.current) await probe.current.close();
    probe.current = new NativeP01Probe();
    await probe.current.initialize(options());
    return probe.current.read();
  };
  const requireProbe = () => {
    if (!probe.current) throw new Error('Inicializa la cuenta sintética primero.');
    return probe.current;
  };

  const button = (label: string, action: () => Promise<ProbeResult | void>) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: working }}
      disabled={working}
      style={({ pressed }) => [styles.button, (working || pressed) && styles.dimmed]}
      onPress={() => void run(action, label)}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen title="Diagnóstico técnico P01">
      <View style={styles.content}>
        <Text style={textStyle}>
          Solo build de prueba. No acredita migración, recepción clínica ni cifrado.
        </Text>
        <Text style={textStyle} accessibilityLiveRegion="polite">
          {message}
        </Text>
        <Text style={textStyle}>Notificaciones P01 observadas en esta sesión: {pushObserved}</Text>
        {result && (
          <Text style={textStyle} selectable>
            Marcadores locales: {result.localRows}
            {'\n'}
            Formularios: {result.forms}; preguntas: {result.questions}; educación:{' '}
            {result.education}
            {'\n'}
            Primera sincronización completada en esta operación:{' '}
            {result.firstSyncComplete ? 'sí' : 'no'}
          </Text>
        )}
        <View style={styles.options}>
          {(['A', 'B'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{
                checked: patient === value,
                disabled: working || !!probe.current,
              }}
              disabled={working || !!probe.current}
              onPress={() => setPatient(value)}
            >
              <Text style={textStyle}>
                Paciente sintético {value}
                {patient === value ? ' seleccionado' : ''}
              </Text>
            </Pressable>
          ))}
        </View>
        {button('Inicializar base sintética', initialize)}
        {button('Guardar marcador local', () => requireProbe().saveLocalMarker())}
        {button('Cerrar y reabrir la base', () => requireProbe().reopen())}
        {button('Consultar persistencia', () => requireProbe().read())}
        {button('Conectar y recibir réplica', () => requireProbe().sync(options()))}
        {button('Cerrar contexto y permitir otra cuenta', async () => {
          await probe.current?.close();
          probe.current = null;
          if (alive.current) setResult(null);
        })}
        {button('Registrar y enviar prueba push al propio teléfono', async () => {
          const token = await acquireProbePushToken(
            process.env.EXPO_PUBLIC_P01_EXPO_PROJECT_ID ?? '',
          );
          const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: token,
              title: 'Prueba QuimioCare',
              body: 'Verificación de transporte P01',
              data: { probe: 'p01' },
            }),
          });
          const body = (await response.json()) as { data?: { status?: string } };
          if (!response.ok || body.data?.status !== 'ok')
            throw new Error('Proveedor no aceptó la prueba push.');
          // El ticket por sí solo no acredita recepción: observar contador y notificación real.
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  dimmed: { opacity: 0.65 },
  options: { gap: 12, marginVertical: 16 },
  button: { backgroundColor: '#134e4a', padding: 16, marginVertical: 6, borderRadius: 8 },
  buttonText: { color: '#ffffff', fontSize: 16 },
});
