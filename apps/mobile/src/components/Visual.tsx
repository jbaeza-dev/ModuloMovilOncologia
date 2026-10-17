import type { ComponentProps, ReactNode, Ref } from 'react';
import {
  type DimensionValue,
  Pressable,
  type ReturnKeyTypeOptions,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
} from 'react-native';

import Feather from '@expo/vector-icons/Feather';
import { useAppTheme } from '../providers/ThemeProvider';
import { isDemoMode } from '../utils/environment';
import { theme } from '../theme';
import type { IconName } from './NavigationCard';

export function DemoBadge() {
  const styles = useStyles();
  if (isDemoMode()) {
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

export function InfoCard({ children, testID }: { children: ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.card}>
      {children}
    </View>
  );
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
  keyboardType?:
    | 'default'
    | 'email-address'
    | 'numeric'
    | 'phone-pad'
    | 'decimal-pad'
    | 'number-pad';
  multiline?: boolean;
  maxLength?: number;
  editable?: boolean;
  helperText?: string;
  errorText?: string;
  inputRef?: Ref<TextInput>;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  blurOnSubmit?: boolean;
  nativeID?: string;
  accessibilityHint?: string;
  editableValueStyle?: boolean;
};

export function VisualField({
  label,
  editable = true,
  helperText,
  errorText,
  inputRef,
  nativeID,
  accessibilityHint,
  editableValueStyle = false,
  ...input
}: FieldProps) {
  const styles = useStyles();
  const { theme: appTheme } = useAppTheme();
  const hasError = Boolean(errorText);

  return (
    <View style={styles.field}>
      <Text nativeID={nativeID ? `${nativeID}-label` : undefined} style={styles.fieldLabel}>
        {label}
      </Text>
      {helperText ? <Text style={styles.fieldHelper}>{helperText}</Text> : null}
      <TextInput
        ref={inputRef}
        {...input}
        editable={editable}
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        aria-invalid={hasError}
        autoCapitalize={input.keyboardType === 'email-address' ? 'none' : 'sentences'}
        placeholderTextColor={appTheme.colors.secondary}
        style={[
          styles.input,
          editableValueStyle && styles.inputEditableValue,
          hasError && styles.inputError,
          input.multiline && styles.multilineInput,
          editable === false && styles.disabledInput,
        ]}
      />
      {hasError ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.fieldErrorRow}
        >
          <Feather name="alert-circle" size={16} color={appTheme.colors.error} accessible={false} />
          <Text style={styles.fieldErrorText}>{errorText}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function DetailRow({
  label,
  value,
  layout = 'horizontal',
}: {
  label: string;
  value: string;
  layout?: 'horizontal' | 'vertical';
}) {
  const styles = useStyles();
  const isVertical = layout === 'vertical';
  return (
    <View style={[styles.row, isVertical && styles.rowVertical]}>
      <Text style={[styles.rowLabel, isVertical && styles.rowLabelVertical]}>{label}</Text>
      <Text style={[styles.rowValue, isVertical && styles.rowValueVertical]}>{value}</Text>
    </View>
  );
}

export function FeedbackBanner({
  title,
  message,
  variant = 'info',
  actionLabel,
  onAction,
}: {
  title: string;
  message?: string;
  variant?: 'success' | 'warning' | 'error' | 'info';
  actionLabel?: string;
  onAction?: () => void;
}) {
  const styles = useStyles();
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;

  const iconName: ComponentProps<typeof Feather>['name'] =
    variant === 'success'
      ? 'check-circle'
      : variant === 'warning'
        ? 'alert-triangle'
        : variant === 'error'
          ? 'alert-circle'
          : 'info';

  const iconColor =
    variant === 'success'
      ? colors.success
      : variant === 'warning'
        ? colors.warning
        : variant === 'error'
          ? colors.error
          : colors.primary;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.feedbackCard, variant === 'error' && styles.feedbackCardError]}
    >
      <View style={styles.feedbackHeader}>
        <Feather name={iconName} size={20} color={iconColor} accessible={false} />
        <Text style={[styles.feedbackTitle, { color: iconColor }]}>{title}</Text>
      </View>
      {message ? <BodyText style={styles.feedbackMessage}>{message}</BodyText> : null}
      {actionLabel && onAction ? (
        <View style={styles.feedbackAction}>
          <VisualButton label={actionLabel} secondary onPress={onAction} />
        </View>
      ) : null}
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
    body: { ...theme.typography.body, color: colors.secondary },
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
      color: colors.onError,
    },
    button: {
      minHeight: 52,
      paddingVertical: theme.spacing.sm,
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
      ...theme.typography.button,
      color: colors.onPrimary,
      textAlign: 'center',
    },
    secondaryLabel: { color: colors.text },
    field: { gap: theme.spacing.sm },
    fieldLabel: { ...theme.typography.label, color: colors.text },
    fieldHelper: { ...theme.typography.helper, color: colors.secondary },
    input: {
      minHeight: 52,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: colors.inputBorder,
      backgroundColor: colors.surface,
      color: colors.text,
      ...theme.typography.body,
    },
    inputEditableValue: {
      ...theme.typography.editableValue,
    },
    inputError: {
      borderColor: colors.error,
    },
    disabledInput: {
      backgroundColor: colors.mutedSurface,
      opacity: 0.6,
      color: colors.secondary,
    },
    fieldErrorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      marginTop: 2,
    },
    fieldErrorText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.error,
      fontWeight: '600',
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
    rowVertical: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 4,
    },
    rowLabel: { flex: 1, fontSize: 14, color: colors.secondary },
    rowLabelVertical: { flex: 0, width: '100%' },
    rowValue: {
      flex: 1,
      textAlign: 'right',
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    rowValueVertical: { flex: 0, textAlign: 'left', width: '100%' },
    feedbackCard: {
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    feedbackCardError: {
      borderColor: colors.error,
      backgroundColor: colors.errorContainer,
    },
    feedbackHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    feedbackTitle: {
      fontSize: 16,
      fontWeight: '700',
    },
    feedbackMessage: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    feedbackAction: {
      marginTop: theme.spacing.xs,
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
