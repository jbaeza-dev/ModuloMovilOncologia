import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../../../providers/ThemeProvider';
import { toggleMultipleChoiceValue } from '../../../data/local/forms/form-validation';
import type { FormAnswerValue, QuestionConfiguration } from '../../../data/local/forms/form-types';

export interface FormQuestionDisplay {
  id: string;
  pregunta: string;
  descripcion?: string | null;
  tipo: string;
  requerida?: boolean;
  configuracion?: QuestionConfiguration;
}

export interface QuestionInputProps {
  question: FormQuestionDisplay;
  value: FormAnswerValue | undefined;
  onChange: (value: FormAnswerValue) => void;
  error?: string;
  disabled?: boolean;
}

export function QuestionInput({
  question,
  value,
  onChange,
  error,
  disabled = false,
}: QuestionInputProps) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);

  const { tipo, configuracion, requerida, pregunta, descripcion } = question;
  const opciones = configuracion?.opciones ?? [];
  const maxLength = configuracion?.maxLength ?? 500;

  const renderSingleChoice = () => {
    const selectedValue = typeof value === 'string' ? value : undefined;

    return (
      <View style={styles.optionsContainer}>
        {opciones.map((option) => {
          const isSelected = selectedValue === option.valor;
          return (
            <Pressable
              key={option.valor}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled }}
              accessibilityLabel={`${option.etiqueta}${isSelected ? ', seleccionado' : ''}`}
              disabled={disabled}
              onPress={() => onChange(option.valor)}
              style={({ pressed }) => [
                styles.optionRow,
                isSelected && styles.optionRowSelected,
                pressed && styles.optionRowPressed,
                disabled && styles.optionRowDisabled,
              ]}
            >
              <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                {isSelected ? <View style={styles.radioInnerCircle} /> : null}
              </View>
              <Text
                style={[
                  styles.optionLabel,
                  isSelected && styles.optionLabelSelected,
                  disabled && styles.optionLabelDisabled,
                ]}
              >
                {option.etiqueta}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderMultipleChoice = () => {
    const currentValues = Array.isArray(value) ? (value as string[]) : [];

    return (
      <View style={styles.optionsContainer}>
        <Text style={styles.multipleChoiceHelper}>Puedes marcar más de una opción.</Text>
        {opciones.map((option) => {
          const isSelected = currentValues.includes(option.valor);
          return (
            <Pressable
              key={option.valor}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected, disabled }}
              accessibilityLabel={`${option.etiqueta}${isSelected ? ', marcado' : ''}`}
              disabled={disabled}
              onPress={() => {
                const next = toggleMultipleChoiceValue(currentValues, option.valor, opciones);
                onChange(next);
              }}
              style={({ pressed }) => [
                styles.optionRow,
                isSelected && styles.optionRowSelected,
                pressed && styles.optionRowPressed,
                disabled && styles.optionRowDisabled,
              ]}
            >
              <View style={[styles.checkboxSquare, isSelected && styles.checkboxSquareSelected]}>
                {isSelected ? (
                  <Feather
                    name="check"
                    size={16}
                    color={appTheme.colors.surface}
                    accessible={false}
                  />
                ) : null}
              </View>
              <Text
                style={[
                  styles.optionLabel,
                  isSelected && styles.optionLabelSelected,
                  disabled && styles.optionLabelDisabled,
                ]}
              >
                {option.etiqueta}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderScale0To10 = () => {
    const selectedScale = typeof value === 'number' ? value : undefined;
    const scaleNumbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const minEtiqueta = configuracion?.minEtiqueta ?? '0 = Nada';
    const maxEtiqueta = configuracion?.maxEtiqueta ?? '10 = Máximo';

    return (
      <View style={styles.scaleContainer}>
        <View style={styles.scaleLabelsRow}>
          <Text style={styles.scaleBoundaryLabel}>{minEtiqueta}</Text>
          <Text style={styles.scaleBoundaryLabel}>{maxEtiqueta}</Text>
        </View>
        <View style={styles.scaleGrid}>
          {scaleNumbers.map((num) => {
            const isSelected = selectedScale === num;
            return (
              <Pressable
                key={num}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected, disabled }}
                accessibilityLabel={`Nivel ${num}${isSelected ? ', seleccionado' : ''}`}
                disabled={disabled}
                onPress={() => onChange(num)}
                style={({ pressed }) => [
                  styles.scaleButton,
                  isSelected && styles.scaleButtonSelected,
                  pressed && styles.scaleButtonPressed,
                  disabled && styles.scaleButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.scaleButtonText,
                    isSelected && styles.scaleButtonTextSelected,
                    disabled && styles.scaleButtonTextDisabled,
                  ]}
                >
                  {num}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const renderText = () => {
    const textValue = typeof value === 'string' ? value : '';
    const charCount = textValue.length;

    return (
      <View style={styles.textContainer}>
        <TextInput
          value={textValue}
          onChangeText={(newText) => onChange(newText)}
          multiline
          maxLength={maxLength}
          placeholder="Escribe tu respuesta aquí (opcional)..."
          placeholderTextColor={appTheme.colors.secondary}
          editable={!disabled}
          accessibilityLabel={pregunta}
          style={[styles.textInput, disabled && styles.textInputDisabled]}
        />
        <View style={styles.counterRow}>
          <Text style={styles.counterText}>
            {charCount} de {maxLength} caracteres
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.questionCard}>
      <View style={styles.headerRow}>
        <Text style={styles.questionTitle}>
          {pregunta}
          {requerida ? <Text style={styles.requiredAsterisk}> *</Text> : null}
        </Text>
      </View>
      {descripcion ? <Text style={styles.questionDescription}>{descripcion}</Text> : null}

      <View style={styles.inputBody}>
        {tipo === 'single_choice' && renderSingleChoice()}
        {tipo === 'multiple_choice' && renderMultipleChoice()}
        {tipo === 'scale_0_10' && renderScale0To10()}
        {tipo === 'text' && renderText()}
      </View>

      {error ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.errorContainer}
        >
          <Feather name="alert-circle" size={16} color={appTheme.colors.error} accessible={false} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  text: string;
  border: string;
  error: string;
  surfaceVariant?: string;
}) {
  return StyleSheet.create({
    questionCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 6,
    },
    questionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      flex: 1,
      lineHeight: 22,
    },
    requiredAsterisk: {
      color: colors.error,
      fontWeight: '700',
    },
    questionDescription: {
      fontSize: 14,
      color: colors.secondary,
      marginBottom: 12,
      lineHeight: 20,
    },
    inputBody: {
      marginTop: 4,
    },
    optionsContainer: {
      gap: 10,
    },
    multipleChoiceHelper: {
      fontSize: 13,
      color: colors.secondary,
      fontStyle: 'italic',
      marginBottom: 6,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    optionRowSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceVariant ?? '#F0F7FF',
    },
    optionRowPressed: {
      opacity: 0.8,
    },
    optionRowDisabled: {
      opacity: 0.5,
    },
    radioCircle: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    radioCircleSelected: {
      borderColor: colors.primary,
    },
    radioInnerCircle: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    checkboxSquare: {
      width: 22,
      height: 22,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    checkboxSquareSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    optionLabel: {
      fontSize: 15,
      color: colors.text,
      flex: 1,
      lineHeight: 20,
    },
    optionLabelSelected: {
      fontWeight: '600',
      color: colors.primary,
    },
    optionLabelDisabled: {
      color: colors.secondary,
    },
    scaleContainer: {
      marginTop: 6,
    },
    scaleLabelsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    scaleBoundaryLabel: {
      fontSize: 13,
      color: colors.secondary,
      fontWeight: '500',
    },
    scaleGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      justifyContent: 'space-between',
    },
    scaleButton: {
      minWidth: 44,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 8,
    },
    scaleButtonSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    scaleButtonPressed: {
      opacity: 0.8,
    },
    scaleButtonDisabled: {
      opacity: 0.5,
    },
    scaleButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    scaleButtonTextSelected: {
      color: colors.surface,
      fontWeight: '700',
    },
    scaleButtonTextDisabled: {
      color: colors.secondary,
    },
    textContainer: {
      marginTop: 4,
    },
    textInput: {
      minHeight: 100,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      color: colors.text,
      textAlignVertical: 'top',
      backgroundColor: colors.surface,
    },
    textInputDisabled: {
      backgroundColor: colors.border,
      opacity: 0.6,
    },
    counterRow: {
      alignItems: 'flex-end',
      marginTop: 6,
    },
    counterText: {
      fontSize: 12,
      color: colors.secondary,
    },
    errorContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
    },
    errorText: {
      fontSize: 13,
      color: colors.error,
      fontWeight: '500',
    },
  });
}
