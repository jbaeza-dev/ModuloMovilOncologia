import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MascotAvatar } from './MascotAvatar';
import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

export function AppLoadingScreen() {
  const {
    theme: { colors },
  } = useAppTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View accessibilityLiveRegion="polite" style={styles.content}>
        <MascotAvatar pose="saludo" size="hero" framed={false} />
        <Text style={[theme.typography.screenTitle, { color: colors.text }]}>QuimioCare</Text>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[theme.typography.body, { color: colors.secondary }]}>
          Preparando tu espacio…
        </Text>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center' },
  content: { alignItems: 'center', padding: 24, gap: 20 },
});
