import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useNavigationState } from 'expo-router/react-navigation';
import type { ReactNode, RefObject } from 'react';
import {
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

type Props = {
  children: ReactNode;
  title?: string;
  isRoot?: boolean;
  showProfile?: boolean;
  scroll?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
  bottomAction?: ReactNode;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
};

export function Screen({
  children,
  title,
  isRoot = false,
  showProfile = false,
  scroll = true,
  scrollRef,
  bottomAction,
  onScroll,
  scrollEventThrottle,
}: Props) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const hasBackHistory = useNavigationState((state) => (state ? state.index > 0 : false));
  const canGoBack = !isRoot && hasBackHistory;

  const { fontScale, height } = useWindowDimensions();
  const isConstrained = fontScale > 1.3 || height < 550;
  const renderBottomActionInline = Boolean(bottomAction && scroll && isConstrained);

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
        {canGoBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              }
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
            style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
          >
            <View style={styles.avatar}>
              <Feather name="user" size={18} color={appTheme.colors.primary} accessible={false} />
            </View>
            <Text style={styles.profileText}>Mi perfil</Text>
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
          <ScrollView
            ref={scrollRef}
            onScroll={onScroll}
            scrollEventThrottle={scrollEventThrottle}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {content}
            {renderBottomActionInline ? (
              <View testID="screen-bottom-action-inline" style={styles.inlineBottomAction}>
                {bottomAction}
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.staticContent}>{content}</View>
        )}
        {!renderBottomActionInline && bottomAction ? (
          <View testID="screen-bottom-action-container" style={styles.bottomActionContainer}>
            {bottomAction}
          </View>
        ) : null}
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
    profileButton: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: theme.spacing.sm,
      gap: theme.spacing.xs,
      borderRadius: 24,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryContainer,
    },
    profileText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
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
    inlineBottomAction: {
      marginTop: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    bottomActionContainer: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: theme.spacing.sm,
    },
    title: { fontSize: 28, fontWeight: '700', color: colors.text },
    pressed: { backgroundColor: colors.pressed },
  });
}
