import Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

type Props = {
  children: ReactNode;
  title?: string;
  backTo?: Href;
  showProfile?: boolean;
  scroll?: boolean;
};

export function Screen({ children, title, backTo, showProfile = false, scroll = true }: Props) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const content = (
    <>
      {title ? (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {children}
    </>
  );
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {backTo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace(backTo);
            }}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <Feather name="arrow-left" size={24} color={appTheme.colors.text} accessible={false} />
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
        <Text style={styles.brand}>QuimioCare</Text>
        {showProfile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir mi perfil"
            onPress={() => router.navigate('/perfil', { withAnchor: true })}
            style={({ pressed }) => [styles.headerAction, styles.avatar, pressed && styles.pressed]}
          >
            <Feather name="user" size={24} color={appTheme.colors.primary} accessible={false} />
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {content}
          </ScrollView>
        ) : (
          <View style={styles.staticContent}>{content}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    body: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    headerAction: {
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 24,
    },
    avatar: { backgroundColor: colors.primaryContainer },
    brand: {
      flex: 1,
      textAlign: 'center',
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
    },
    content: {
      flexGrow: 1,
      padding: theme.spacing.lg,
      gap: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    staticContent: { flex: 1, padding: theme.spacing.lg, gap: theme.spacing.lg },
    title: { fontSize: 28, fontWeight: '700', color: colors.text },
    pressed: { backgroundColor: colors.pressed },
  });
}
