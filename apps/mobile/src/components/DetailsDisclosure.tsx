import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';
import { AppIcon } from './AppIcon';

/** La información secundaria se consulta a petición; nunca oculta acciones urgentes. */
export function DetailsDisclosure({
  title = 'Más información',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    theme: { colors },
  } = useAppTheme();
  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={[styles.button, { borderColor: colors.border }]}
      >
        <Text style={[styles.title, { color: colors.primary }]}>{title}</Text>
        <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
      </Pressable>
      {expanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  button: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  title: { ...theme.typography.label, flex: 1 },
  content: { gap: 10 },
});
