import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { type DimensionValue, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../theme';
import type { IconName } from './NavigationCard';

export function DemoBadge() {
  return <Text style={styles.demo}>VISTA DE DEMOSTRACIÓN · DATOS FICTICIOS</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

export function InfoCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function BodyText({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function StatusPill({ children }: { children: ReactNode }) {
  return <Text style={styles.pill}>{children}</Text>;
}

type ButtonProps = {
  label: string;
  onPress?: () => void;
  secondary?: boolean;
  disabled?: boolean;
};

export function VisualButton({ label, onPress, secondary = false, disabled = false }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || !onPress }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (disabled || !onPress) && styles.disabledButton,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonLabel, secondary && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
};

export function VisualField({ label, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        autoCapitalize={input.keyboardType === 'email-address' ? 'none' : 'sentences'}
        placeholderTextColor={theme.colors.secondary}
        style={styles.input}
      />
    </View>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.selectedChip]}
    >
      <Text style={[styles.chipText, selected && styles.selectedChipText]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: IconName;
  title: string;
  description: string;
}) {
  return (
    <InfoCard>
      <View style={styles.empty}>
        <Feather name={icon} size={36} color={theme.colors.secondary} accessible={false} />
        <Text style={styles.emptyTitle}>{title}</Text>
        <BodyText>{description}</BodyText>
      </View>
    </InfoCard>
  );
}

export function ProgressBar({ progress }: { progress: number }) {
  return (
    <View accessibilityLabel={String(progress) + '% completado'} style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: (String(progress) + '%') as DimensionValue }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  demo: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: theme.colors.secondary },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  card: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  body: { fontSize: 15, lineHeight: 23, color: theme.colors.secondary },
  pill: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: theme.colors.mutedSurface,
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  button: {
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.text,
  },
  secondaryButton: { backgroundColor: theme.colors.mutedSurface },
  disabledButton: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.inverse,
    textAlign: 'center',
  },
  secondaryLabel: { color: theme.colors.text },
  field: { gap: theme.spacing.sm },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  input: {
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowLabel: { flex: 1, fontSize: 14, color: theme.colors.secondary },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 24,
    backgroundColor: theme.colors.background,
  },
  selectedChip: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipText: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  selectedChipText: { color: theme.colors.inverse },
  empty: { alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.lg },
  emptyTitle: { fontSize: 19, fontWeight: '700', color: theme.colors.text, textAlign: 'center' },
  progressTrack: {
    height: 9,
    overflow: 'hidden',
    borderRadius: 5,
    backgroundColor: theme.colors.mutedSurface,
  },
  progressFill: { height: 9, borderRadius: 5, backgroundColor: theme.colors.text },
});
