import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAppTheme } from '../providers/ThemeProvider';

/** A single document toolbar, without the app header or padded card shell. */
export function DocumentScreen({ children }: { children: ReactNode }) {
  const {
    theme: { colors },
  } = useAppTheme();
  return (
    <SafeAreaView
      testID="document-fullscreen"
      style={[styles.screen, { backgroundColor: colors.surface }]}
    >
      <StatusBar hidden />
      {children}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ screen: { flex: 1 } });
