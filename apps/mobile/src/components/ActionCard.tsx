import { AppIcon as Feather } from './AppIcon';
import React, { type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

export interface ActionCardProps {
  title: string;
  description?: string;
  icon: ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  accessibilityLabel?: string;
  layout?: 'row' | 'tile';
  tone?: 'neutral' | 'tinted' | 'warning' | 'solid';
  compact?: boolean;
}

/** Tarjetas del mockup, con texto completo y una única acción accesible. */
export function ActionCard({
  title,
  description,
  icon,
  onPress,
  accessibilityLabel,
  layout = 'row',
  tone = 'neutral',
  compact = false,
}: ActionCardProps) {
  const {
    theme: { colors },
  } = useAppTheme();
  const tile = layout === 'tile';
  const warning = tone === 'warning';
  const solid = tone === 'solid';
  const textColor = solid
    ? colors.onPrimary
    : warning
      ? colors.warning
      : (colors.heading ?? colors.text);
  const backgroundColor = solid
    ? colors.primary
    : warning
      ? colors.warningContainer
      : tone === 'tinted'
        ? colors.primaryContainer
        : colors.surface;
  const borderColor = warning
    ? colors.warning
    : tone === 'neutral'
      ? colors.border
      : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={description}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        tile && styles.tile,
        compact && styles.compact,
        { backgroundColor, borderColor },
        pressed && styles.pressed,
      ]}
    >
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.icon,
          compact && styles.compactIcon,
          tile && styles.tileIcon,
          {
            backgroundColor: tile
              ? 'transparent'
              : solid
                ? 'rgba(255,255,255,0.2)'
                : warning
                  ? colors.surface
                  : colors.primaryContainer,
          },
        ]}
      >
        <Feather name={icon} size={tile ? 28 : compact ? 22 : 26} color={textColor} />
      </View>
      <View style={[styles.copy, tile && styles.tileCopy]}>
        <Text style={[styles.title, compact && styles.compactTitle, { color: textColor }]}>
          {title}
        </Text>
        {description ? (
          <Text
            style={[
              styles.description,
              { color: solid ? colors.onPrimary : warning ? colors.warning : colors.secondary },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {!tile ? (
        <Feather name="chevron-right" size={24} color={textColor} accessible={false} />
      ) : null}
    </Pressable>
  );
}

export function ActionCardGrid({ children }: { children: ReactNode }) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.3;
  return (
    <View style={[styles.grid, stacked && styles.stacked]}>
      {React.Children.toArray(children).map((child, index) => (
        <View key={index} style={styles.cell}>
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 12 },
  stacked: { flexDirection: 'column' },
  cell: { flex: 1, minWidth: '45%' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 15,
    minHeight: 76,
    borderWidth: 2,
    borderRadius: 20,
  },
  tileCopy: { flex: 0, flexGrow: 0, alignSelf: 'stretch' },
  tile: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 10,
    minHeight: 148,
    borderWidth: 1,
    padding: 16,
  },
  compact: { minHeight: 76, paddingVertical: 12, gap: 12 },
  icon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  compactIcon: { width: 44, height: 44, borderRadius: 14 },
  tileIcon: { width: 32, height: 32, borderRadius: 0, alignItems: 'flex-start' },
  copy: { flex: 1, alignSelf: 'stretch', gap: 4, minWidth: 0 },
  title: { ...theme.typography.sectionTitle, fontSize: 17.5, lineHeight: 23 },
  compactTitle: { fontSize: 17, lineHeight: 23 },
  description: { ...theme.typography.body, fontSize: 15, lineHeight: 22 },
  pressed: { opacity: 0.75 },
});
