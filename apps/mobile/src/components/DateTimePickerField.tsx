import Feather from '@expo/vector-icons/Feather';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../providers/ThemeProvider';
import { isValidCivilDate, isValidTimeHhMm } from '../services/reminders/reminder-date-utils';
import { formatCivilDateDisplay } from '../services/reminders/reminder-status';
import { theme } from '../theme';
import { BodyText, VisualButton } from './Visual';

interface BasePickerProps {
  label: string;
  helperText?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}

interface TimePickerFieldProps extends BasePickerProps {
  mode: 'time';
  value: string;
  onChange: (nextTimeHhMm: string) => void;
}

interface DatePickerFieldProps extends BasePickerProps {
  mode: 'date';
  value: string | null;
  onChange: (nextCivilDate: string) => void;
  minimumDate?: string | null;
  maximumDate?: string | null;
  placeholder?: string;
}

export type DateTimePickerFieldProps = TimePickerFieldProps | DatePickerFieldProps;

function timeStringToDate(hhMm: string): Date {
  const date = new Date();
  if (isValidTimeHhMm(hhMm)) {
    const [hours, minutes] = hhMm.split(':').map(Number);
    date.setHours(hours, minutes, 0, 0);
  } else {
    date.setHours(7, 0, 0, 0);
  }
  return date;
}

function civilDateToLocalDate(civilDate: string | null | undefined): Date {
  if (civilDate && isValidCivilDate(civilDate)) {
    const [year, month, day] = civilDate.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

function formatDateFromPicker(selected: Date): string {
  const year = String(selected.getFullYear()).padStart(4, '0');
  const month = String(selected.getMonth() + 1).padStart(2, '0');
  const day = String(selected.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeFromPicker(selected: Date): string {
  const hours = String(selected.getHours()).padStart(2, '0');
  const minutes = String(selected.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function DateTimePickerField(props: DateTimePickerFieldProps) {
  const { label, helperText, accessibilityLabel, disabled = false, mode } = props;
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();

  const [showPicker, setShowPicker] = useState(false);
  const [showKeyboardInput, setShowKeyboardInput] = useState(false);
  const [keyboardDraft, setKeyboardDraft] = useState(props.value ?? '');
  const keyboardDraftRef = useRef(props.value ?? '');
  const [keyboardError, setKeyboardError] = useState<string | null>(null);

  const handleOpenPicker = () => {
    if (disabled) return;
    setKeyboardError(null);
    setShowPicker(true);
  };

  const handlePickerChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS !== 'ios') {
      setShowPicker(false);
    }

    // Si el usuario cancela el diálogo nativo, conservar intacto el valor previo
    if (event.type === 'dismissed' || !selectedDate) {
      return;
    }

    if (props.mode === 'time') {
      const formatted = formatTimeFromPicker(selectedDate);
      props.onChange(formatted);
      keyboardDraftRef.current = formatted;
      setKeyboardDraft(formatted);
    } else {
      const formatted = formatDateFromPicker(selectedDate);
      props.onChange(formatted);
      keyboardDraftRef.current = formatted;
      setKeyboardDraft(formatted);
    }
  };

  const handleApplyKeyboardInput = () => {
    const trimmed = keyboardDraftRef.current.trim();
    if (props.mode === 'time') {
      if (!isValidTimeHhMm(trimmed)) {
        setKeyboardError('Ingresa una hora válida en formato 24h HH:mm (ej. 07:00).');
        return;
      }
      setKeyboardError(null);
      props.onChange(trimmed);
      setShowKeyboardInput(false);
    } else {
      if (!isValidCivilDate(trimmed)) {
        setKeyboardError('Ingresa una fecha real en formato AAAA-MM-DD (ej. 2026-10-16).');
        return;
      }
      setKeyboardError(null);
      props.onChange(trimmed);
      setShowKeyboardInput(false);
    }
  };

  const displayValue =
    props.mode === 'time'
      ? props.value || '07:00'
      : props.value
        ? `${formatCivilDateDisplay(props.value)} (${props.value})`
        : (props.placeholder ?? 'Seleccionar fecha');

  const pickerValue =
    props.mode === 'time' ? timeStringToDate(props.value) : civilDateToLocalDate(props.value);

  const minimumDate =
    props.mode === 'date' && isValidCivilDate(props.minimumDate)
      ? civilDateToLocalDate(props.minimumDate)
      : undefined;

  const maximumDate =
    props.mode === 'date' && isValidCivilDate(props.maximumDate)
      ? civilDateToLocalDate(props.maximumDate)
      : undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      {helperText ? <BodyText style={styles.helper}>{helperText}</BodyText> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={handleOpenPicker}
        style={({ pressed }) => [
          styles.selectorButton,
          disabled && styles.selectorDisabled,
          pressed && !disabled && { backgroundColor: appTheme.colors.pressed },
        ]}
      >
        <View style={styles.valueRow}>
          <Feather
            name={mode === 'time' ? 'clock' : 'calendar'}
            size={20}
            color={appTheme.colors.primary}
          />
          <Text style={styles.valueText}>{displayValue}</Text>
        </View>
        <Text style={styles.changeActionText}>Cambiar</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          mode === 'time'
            ? `Escribir hora con teclado para ${label}`
            : `Escribir fecha con teclado para ${label}`
        }
        onPress={() => {
          const initial = props.value ?? '';
          keyboardDraftRef.current = initial;
          setKeyboardDraft(initial);
          setKeyboardError(null);
          setShowKeyboardInput((prev) => !prev);
        }}
        style={styles.keyboardToggle}
      >
        <Text style={styles.keyboardToggleText}>
          {showKeyboardInput
            ? 'Ocultar ingreso por teclado'
            : mode === 'time'
              ? 'Prefiero escribir la hora con el teclado'
              : 'Prefiero escribir la fecha con el teclado'}
        </Text>
      </Pressable>

      {showKeyboardInput ? (
        <View style={styles.keyboardBox}>
          <View style={styles.keyboardRow}>
            <TextInput
              style={styles.textInput}
              value={keyboardDraft}
              onChangeText={(text) => {
                keyboardDraftRef.current = text;
                setKeyboardDraft(text);
                if (keyboardError) setKeyboardError(null);
              }}
              placeholder={mode === 'time' ? '07:00' : '2026-10-16'}
              placeholderTextColor={appTheme.colors.secondary}
              keyboardType="numbers-and-punctuation"
              maxLength={mode === 'time' ? 5 : 10}
              accessibilityLabel={
                mode === 'time'
                  ? `Campo de texto hora para ${label}`
                  : `Campo de texto fecha para ${label}`
              }
            />
            <VisualButton
              label={mode === 'time' ? 'Aplicar hora' : 'Aplicar fecha'}
              onPress={handleApplyKeyboardInput}
            />
          </View>
          {keyboardError ? <Text style={styles.errorText}>{keyboardError}</Text> : null}
        </View>
      ) : null}

      {showPicker ? (
        <DateTimePicker
          testID={mode === 'time' ? 'native-time-picker' : 'native-date-picker'}
          value={pickerValue}
          mode={mode}
          is24Hour={true}
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handlePickerChange}
        />
      ) : null}
    </View>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;

  return StyleSheet.create({
    container: {
      gap: 6,
      marginVertical: theme.spacing.xs,
    },
    label: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    helper: {
      fontSize: 13,
      color: colors.secondary,
    },
    selectorButton: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: theme.spacing.sm,
    },
    selectorDisabled: {
      opacity: 0.6,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      flex: 1,
    },
    valueText: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    changeActionText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.primary,
    },
    keyboardToggle: {
      minHeight: 36,
      justifyContent: 'center',
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    keyboardToggleText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
      textDecorationLine: 'underline',
    },
    keyboardBox: {
      gap: 4,
      marginTop: 4,
    },
    keyboardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    textInput: {
      flex: 1,
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    errorText: {
      fontSize: 13,
      color: '#dc2626',
    },
  });
}
