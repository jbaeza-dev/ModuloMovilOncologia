import Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

export type IconName = ComponentProps<typeof Feather>['name'];

type Props = {
  title: string;
  description?: string;
  icon: IconName;
  href: Href;
  primary?: boolean;
  replace?: boolean;
  navigationMethod?: 'navigate' | 'push';
  compact?: boolean;
};

export function NavigationCard({
  title,
  description,
  icon,
  href,
  primary = false,
  replace = false,
  navigationMethod = 'navigate',
  compact = false,
}: Props) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const color = primary ? appTheme.colors.onPrimary : appTheme.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      onPress={() => {
        if (replace) router.replace(href);
        else if (navigationMethod === 'push') router.push(href);
        else router.navigate(href, { withAnchor: true });
      }}
      style={({ pressed }) => [
        styles.card,
        compact && styles.compactCard,
        primary && styles.primary,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.icon, compact && styles.compactIcon, primary && styles.primaryIcon]}>
        <Feather name={icon} size={compact ? 20 : 24} color={color} accessible={false} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, compact && styles.compactTitle, primary && styles.inverse]}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.description, primary && styles.inverse]}>{description}</Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={compact ? 18 : 20} color={color} accessible={false} />
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      minHeight: 80,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      backgroundColor: colors.surface,
      borderRadius: theme.radius.md,
    },
    compactCard: {
      minHeight: 48,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      gap: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      marginVertical: 2,
    },
    primary: { backgroundColor: colors.primary },
    pressed: { opacity: 0.7 },
    icon: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.sm,
      backgroundColor: colors.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactIcon: {
      width: 36,
      height: 36,
    },
    primaryIcon: { backgroundColor: colors.onPrimaryContainer },
    copy: { flex: 1, gap: theme.spacing.xs },
    title: { fontSize: 17, fontWeight: '600', color: colors.text },
    compactTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    description: { fontSize: 14, lineHeight: 21, color: colors.secondary },
    inverse: { color: colors.onPrimary },
  });
}
