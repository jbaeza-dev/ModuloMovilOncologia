import { AppIcon as Feather } from './AppIcon';
import { router } from 'expo-router';
import { useNavigationState } from 'expo-router/react-navigation';
import { useContext, type ReactNode, type RefObject } from 'react';
import {
  Image,
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

import {
  BRAND_SYMBOL_DARK,
  BRAND_SYMBOL_LIGHT,
  MascotAvatar,
  type MascotPose,
} from './MascotAvatar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBottomInsetHandledContext } from './ScreenInsets';

import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

type Props = {
  children: ReactNode;
  title?: string;
  /** Pose oficial de la mascota mostrada (decorativa) junto al título de la pantalla. */
  mascotPose?: MascotPose;
  isRoot?: boolean;
  showProfile?: boolean;
  showHelp?: boolean;
  scroll?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
  bottomAction?: ReactNode;
  fixedHeader?: ReactNode;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
};

export function Screen({
  children,
  title,
  mascotPose,
  isRoot = false,
  showProfile = false,
  showHelp = false,
  scroll = true,
  scrollRef,
  bottomAction,
  fixedHeader,
  onScroll,
  scrollEventThrottle,
}: Props) {
  const { theme: appTheme } = useAppTheme();
  const bottomInsetHandled = useContext(ScreenBottomInsetHandledContext);
  const styles = createStyles(appTheme.colors);
  // A child navigator can be at index zero while its parent still has the real origin.
  const hasBackHistory = useNavigationState(() => router.canGoBack());
  const canGoBack = !isRoot && hasBackHistory;

  const { fontScale, height } = useWindowDimensions();
  const isConstrained = fontScale > 1.3 || height < 550;
  const isLargeFont = fontScale >= 1.2;
  const renderBottomActionInline = Boolean(bottomAction && scroll && isConstrained);

  // Al aumentar la letra (≥ 120%) o en subpantallas con título propio, ocultamos la marca central para evitar desbordes
  const showBrandText = !isLargeFont && isRoot;

  const content = (
    <>
      {title && mascotPose ? (
        <View style={styles.titleRow}>
          <MascotAvatar pose={mascotPose} size="sm" />
          <Text accessibilityRole="header" style={[styles.title, styles.titleFlex]}>
            {title}
          </Text>
        </View>
      ) : title ? (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {children}
    </>
  );

  return (
    <SafeAreaView
      testID="screen-safe-area"
      style={styles.safeArea}
      edges={bottomInsetHandled ? ['top', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}
    >
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
        ) : showHelp ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir asistente de orientación"
            onPress={() => router.push('/asistente')}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <Feather
              name="message-square"
              size={24}
              color={appTheme.colors.primary}
              accessible={false}
            />
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}

        {isRoot ? (
          <View
            style={styles.brandRow}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            <Image
              source={appTheme.colorScheme === 'dark' ? BRAND_SYMBOL_DARK : BRAND_SYMBOL_LIGHT}
              resizeMode="contain"
              accessible={false}
              style={styles.brandSymbol}
            />
            {showBrandText ? <Text style={styles.brand}>QuimioCare</Text> : null}
          </View>
        ) : (
          <View style={styles.brandSpacer} />
        )}

        {showProfile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir mi perfil"
            onPress={() => router.push('/perfil')}
            style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
          >
            <View style={styles.avatar}>
              <Feather name="user" size={18} color={appTheme.colors.primary} accessible={false} />
            </View>
            {!isLargeFont ? <Text style={styles.profileText}>Mi perfil</Text> : null}
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>
      {fixedHeader}
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
      minHeight: 56,
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
      fontFamily: 'NunitoSans-SemiBold',
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    brandRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    brandSymbol: {
      width: 24,
      height: 24,
    },
    brand: {
      textAlign: 'center',
      fontFamily: 'NunitoSans-Bold',
      fontSize: 22,
      fontWeight: '800',
      color: colors.heading ?? colors.text,
    },
    brandSpacer: {
      flex: 1,
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
    title: {
      fontFamily: 'NunitoSans-Bold',
      fontSize: 28,
      fontWeight: '800',
      color: colors.heading,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    titleFlex: { flex: 1 },
    pressed: { backgroundColor: colors.pressed },
  });
}
