import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import {
  type DimensionValue,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
} from 'react-native';

import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';
import type { IconName } from './NavigationCard';

export function DemoBadge() {
  const styles = useStyles();
  if (process.env.NODE_ENV === 'test') {
    return <Text style={styles.demo}>VISTA DE DEMOSTRACIÓN · DATOS FICTICIOS</Text>;
  }
  return null;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

export function InfoCard({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.card}>{children}</View>;
}

export function BodyText({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const styles = useStyles();
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function StatusPill({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: 'default' | 'danger';
}) {
  const styles = useStyles();
  return <Text style={[styles.pill, variant === 'danger' && styles.dangerPill]}>{children}</Text>;
}

type ButtonProps = {
  label: string;
  onPress?: () => void;
  secondary?: boolean;
  disabled?: boolean;
};

export function VisualButton({ label, onPress, secondary = false, disabled = false }: ButtonProps) {
  const styles = useStyles();
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
  onChangeText?: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  multiline?: boolean;
  maxLength?: number;
  editable?: boolean;
};

export function VisualField({ label, editable = true, ...input }: FieldProps) {
  const styles = useStyles();
  const { theme: appTheme } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        editable={editable}
        accessibilityLabel={label}
        autoCapitalize={input.keyboardType === 'email-address' ? 'none' : 'sentences'}
        placeholderTextColor={appTheme.colors.secondary}
        style={[
          styles.input,
          input.multiline && styles.multilineInput,
          editable === false && styles.disabledInput,
        ]}
      />
    </View>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
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
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.selectedChip, disabled && styles.disabledChip]}
    >
      <Text
        style={[
          styles.chipText,
          selected && styles.selectedChipText,
          disabled && !selected && styles.disabledChipText,
        ]}
      >
        {label}
      </Text>
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
  const styles = useStyles();
  const { theme: appTheme } = useAppTheme();
  return (
    <InfoCard>
      <View style={styles.empty}>
        <Feather name={icon} size={36} color={appTheme.colors.secondary} accessible={false} />
        <Text style={styles.emptyTitle}>{title}</Text>
        <BodyText>{description}</BodyText>
      </View>
    </InfoCard>
  );
}

export function ProgressBar({ progress }: { progress: number }) {
  const styles = useStyles();
  return (
    <View accessibilityLabel={String(progress) + '% completado'} style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: (String(progress) + '%') as DimensionValue }]} />
    </View>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;
  return StyleSheet.create({
    demo: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: colors.secondary },
    sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
    card: {
      padding: theme.spacing.md,
      gap: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: colors.surface,
    },
    body: { fontSize: 15, lineHeight: 23, color: colors.secondary },
    pill: {
      alignSelf: 'flex-start',
      overflow: 'hidden',
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 20,
      backgroundColor: colors.primaryContainer,
      color: colors.onPrimaryContainer,
      fontSize: 13,
      fontWeight: '600',
    },
    dangerPill: {
      backgroundColor: colors.error,
      color: '#FFFFFF',
    },
    button: {
      minHeight: 52,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    secondaryButton: { backgroundColor: colors.mutedSurface },
    disabledButton: { opacity: 0.55 },
    pressed: { opacity: 0.75 },
    buttonLabel: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.onPrimary,
      textAlign: 'center',
    },
    secondaryLabel: { color: colors.text },
    field: { gap: theme.spacing.sm },
    fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
    input: {
      minHeight: 52,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.sm,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 16,
    },
    disabledInput: {
      backgroundColor: colors.mutedSurface,
      opacity: 0.6,
      color: colors.secondary,
    },
    multilineInput: { minHeight: 112, textAlignVertical: 'top', paddingVertical: theme.spacing.md },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowLabel: { flex: 1, fontSize: 14, color: colors.secondary },
    rowValue: {
      flex: 1,
      textAlign: 'right',
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    chip: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.background,
    },
    selectedChip: { backgroundColor: colors.primary, borderColor: colors.primary },
    disabledChip: { opacity: 0.5 },
    chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
    selectedChipText: { color: colors.onPrimary },
    disabledChipText: { color: colors.secondary },
    empty: { alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.lg },
    emptyTitle: { fontSize: 19, fontWeight: '700', color: colors.text, textAlign: 'center' },
    progressTrack: {
      height: 9,
      overflow: 'hidden',
      borderRadius: 5,
      backgroundColor: colors.mutedSurface,
    },
    progressFill: { height: 9, borderRadius: 5, backgroundColor: colors.primary },
  });
}
