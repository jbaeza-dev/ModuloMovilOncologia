import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Screen } from '../../components/Screen';
import { BodyText, VisualButton } from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';
import { SessionNotice, useIdentity } from '../access/SessionScreens';
import { ClinicalSyncNotice, useClinicalSyncSummary } from './ClinicalSyncNotice';

/** Keep the persistent status actionable without crowding out the active screen. */
export function GlobalStatusNotice() {
  const { snapshot, data } = useIdentity();
  const { summary } = useClinicalSyncSummary();
  const { theme } = useAppTheme();
  const sessionPending = Boolean(
    snapshot.user && !['context_ready', 'closing', 'no_identity'].includes(snapshot.state),
  );
  const paused = sessionPending || Boolean(summary?.paused || summary?.runtimePaused);
  const messages = [
    paused ? 'Envíos pausados.' : '',
    summary?.pending ? `${summary.pending} registro(s) pendiente(s).` : '',
    summary?.rejected ? `${summary.rejected} registro(s) rechazado(s).` : '',
  ].filter(Boolean);
  if (!messages.length) return null;
  const label = `${messages.join(' ')} Revisar estado.`;
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: theme.colors.surface }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => router.push(data?.patientId ? '/perfil/estado-envios' : '/acceso')}
        style={{ minHeight: 48, paddingHorizontal: 16, paddingVertical: 8 }}
      >
        <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '600' }}>
          {label}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

export function SyncStatusScreen() {
  return (
    <Screen mascotPose="resumen" title="Estado de los envíos">
      <BodyText>
        Las capturas se conservan en este dispositivo. Revisa aquí los permisos y el estado de
        envío.
      </BodyText>
      <SessionNotice />
      <ClinicalSyncNotice />
      <VisualButton
        label="Revisar consentimiento"
        secondary
        onPress={() => router.push('/perfil/consentimientos')}
      />
      <VisualButton
        label="Consultar historial de signos"
        secondary
        onPress={() => router.push('/vitales')}
      />
      <VisualButton
        label="Consultar seguimientos"
        secondary
        onPress={() => router.push('/formulario')}
      />
    </Screen>
  );
}
