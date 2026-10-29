import type { AnswerValue, FormQuestion } from '@quimiocare/contracts/forms';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BodyText, SectionTitle, VisualField } from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';

export function ContractQuestionInput({
  question: q,
  value,
  onChange,
  error,
  disabled = false,
}: {
  question: FormQuestion;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  error?: string;
  disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  const latestValue = useRef(value);
  latestValue.current = value;
  const multiple = q.tipo === 'opcion_multiple',
    options =
      q.tipo === 'booleano'
        ? [
            { codigo: true, etiqueta: 'Sí' },
            { codigo: false, etiqueta: 'No' },
          ]
        : (q.opciones ?? []);
  const selected = (code: string | boolean) =>
    multiple ? Array.isArray(value) && value.includes(String(code)) : value === code;
  const text = typeof value === 'string' ? value : '';
  const max =
    q.codigo === 'P10'
      ? 500
      : typeof q.configuracion?.max_length === 'number'
        ? q.configuracion.max_length
        : 500;
  const required = q.configuracion?.requerida_si_activa ?? q.requerida;
  const exclusive = q.configuracion?.opciones_exclusivas;
  return (
    <View style={styles.question}>
      <SectionTitle>
        {q.titulo}
        {required ? ' *' : ''}
      </SectionTitle>
      {q.texto ? <BodyText>{q.texto}</BodyText> : null}
      {['booleano', 'opcion_unica', 'opcion_multiple', 'escala_likert'].includes(q.tipo) ? (
        <View
          accessible={false}
          accessibilityRole={multiple ? 'none' : 'radiogroup'}
          accessibilityLabel={q.titulo}
          style={styles.options}
        >
          {multiple ? (
            <BodyText>
              Puedes marcar más de una opción. Las opciones indicadas como exclusivas deben ir
              solas.
            </BodyText>
          ) : null}
          {options.map((option) => (
            <Pressable
              key={String(option.codigo)}
              accessibilityRole={multiple ? 'checkbox' : 'radio'}
              accessibilityLabel={
                option.etiqueta +
                (Array.isArray(exclusive) && exclusive.includes(option.codigo)
                  ? ', opción exclusiva'
                  : '')
              }
              accessibilityState={{ checked: selected(option.codigo), disabled }}
              disabled={disabled}
              onPress={() => {
                if (multiple) {
                  const current = Array.isArray(latestValue.current) ? latestValue.current : [],
                    code = String(option.codigo);
                  // Preserve all choices; validation explains incompatibilities instead of erasing them.
                  const next = current.includes(code)
                    ? current.filter((item) => item !== code)
                    : [...current, code];
                  latestValue.current = next;
                  onChange(next);
                } else onChange(option.codigo);
              }}
              style={[
                styles.option,
                {
                  borderColor: selected(option.codigo) ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected(option.codigo)
                    ? theme.colors.primaryContainer
                    : theme.colors.surface,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 17,
                  color: selected(option.codigo)
                    ? theme.colors.onPrimaryContainer
                    : theme.colors.text,
                }}
              >
                {selected(option.codigo) ? '✓ ' : ''}
                {option.etiqueta}
                {Array.isArray(exclusive) && exclusive.includes(option.codigo)
                  ? ' (opción exclusiva)'
                  : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {q.tipo === 'texto_libre' ? (
        <>
          <VisualField
            label={q.titulo}
            value={text}
            multiline
            editable={!disabled}
            maxLength={max * 2}
            onChangeText={(value) => onChange(value)}
            helperText={`Máximo ${max} caracteres.`}
          />
          <BodyText>
            {Array.from(text).length}/{max} caracteres
          </BodyText>
        </>
      ) : null}
      {q.tipo === 'numerico' ? (
        <VisualField
          label={q.titulo}
          value={typeof value === 'number' ? String(value) : ''}
          editable={!disabled}
          keyboardType="decimal-pad"
          onChangeText={(text) => {
            const normalized = text.replace(',', '.');
            if (!text.trim()) onChange(null);
            else if (/^-?\d+(?:\.\d*)?$/.test(normalized) && Number.isFinite(Number(normalized)))
              onChange(Number(normalized));
          }}
        />
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: theme.colors.error, fontSize: 16 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  question: { gap: 12, marginVertical: 8 },
  options: { gap: 8 },
  option: { minHeight: 52, padding: 14, borderWidth: 2, borderRadius: 12 },
});
