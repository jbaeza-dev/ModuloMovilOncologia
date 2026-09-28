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
};

export function NavigationCard({
  title,
  description,
  icon,
  href,
  primary = false,
  replace = false,
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
        else router.navigate(href, { withAnchor: true });
      }}
      style={({ pressed }) => [styles.card, primary && styles.primary, pressed && styles.pressed]}
    >
      <View style={[styles.icon, primary && styles.primaryIcon]}>
        <Feather name={icon} size={24} color={color} accessible={false} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, primary && styles.inverse]}>{title}</Text>
        {description ? (
          <Text style={[styles.description, primary && styles.inverse]}>{description}</Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={20} color={color} accessible={false} />
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
    primaryIcon: { backgroundColor: colors.onPrimaryContainer },
    copy: { flex: 1, gap: theme.spacing.xs },
    title: { fontSize: 17, fontWeight: '600', color: colors.text },
    description: { fontSize: 14, lineHeight: 21, color: colors.secondary },
    inverse: { color: colors.onPrimary },
  });
}
