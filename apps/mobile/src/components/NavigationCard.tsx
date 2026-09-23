import Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  const color = primary ? theme.colors.inverse : theme.colors.text;
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

const styles = StyleSheet.create({
  card: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
  },
  primary: { backgroundColor: theme.colors.text },
  pressed: { opacity: 0.7 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.mutedSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryIcon: { backgroundColor: theme.colors.secondary },
  copy: { flex: 1, gap: theme.spacing.xs },
  title: { fontSize: 17, fontWeight: '600', color: theme.colors.text },
  description: { fontSize: 14, lineHeight: 21, color: theme.colors.secondary },
  inverse: { color: theme.colors.inverse },
});
