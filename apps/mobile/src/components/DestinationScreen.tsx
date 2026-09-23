import Feather from '@expo/vector-icons/Feather';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type IconName } from './NavigationCard';
import { Screen } from './Screen';
import { theme } from '../theme';

type Props = {
  title: string;
  icon: IconName;
  description: string;
  backTo?: Href;
  notice?: string;
  children?: ReactNode;
};

export function DestinationScreen({ title, icon, description, backTo, notice, children }: Props) {
  return (
    <Screen title={title} backTo={backTo}>
      <View style={styles.panel}>
        <View style={styles.icon}>
          <Feather name={icon} size={32} color={theme.colors.text} accessible={false} />
        </View>
        <Text style={styles.badge}>Próximamente</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
  },
  icon: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 36,
    backgroundColor: theme.colors.mutedSurface,
  },
  badge: { fontSize: 14, fontWeight: '600', color: theme.colors.secondary },
  description: { fontSize: 17, lineHeight: 26, textAlign: 'center', color: theme.colors.text },
  notice: { fontSize: 15, lineHeight: 23, color: theme.colors.secondary },
});
