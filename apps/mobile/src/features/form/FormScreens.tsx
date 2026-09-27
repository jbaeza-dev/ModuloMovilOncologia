import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  ChoiceChip,
  DemoBadge,
  DetailRow,
  InfoCard,
  ProgressBar,
  SectionTitle,
  VisualButton,
} from '../../components/Visual';
import { theme } from '../../theme';

const sections = [
  {
    title: 'Bienestar general',
    question: '¿Cómo te sientes hoy?',
    choices: ['Bien', 'Regular', 'Prefiero no responder'],
  },
  {
    title: 'Observaciones',
    question: '¿Quieres indicar alguna molestia?',
    choices: ['Sí', 'No', 'Prefiero no responder'],
  },
];
export function FormScreen() {
  const [section, setSection] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const current = sections[section];
  return (
    <Screen title="Síntomas de hoy">
      <DemoBadge />
      <Text style={styles.progress}>
        Sección {section + 1} de 2 · {section * 50}%
      </Text>
      <ProgressBar progress={section * 50} />
      <InfoCard>
        <SectionTitle>{current.title}</SectionTitle>
        <BodyText>Pregunta de ejemplo; requiere aprobación clínica.</BodyText>
        <Text style={styles.question}>{current.question}</Text>
        <View style={styles.stack}>
          {current.choices.map((choice) => (
            <ChoiceChip
              key={choice}
              label={choice}
              selected={answers[section] === choice}
              onPress={() => setAnswers({ ...answers, [section]: choice })}
            />
          ))}
        </View>
      </InfoCard>
      <VisualButton
        label={section === 0 ? 'Siguiente sección' : 'Ver resumen de ejemplo'}
        onPress={() => (section === 0 ? setSection(1) : router.navigate('/formulario/resumen'))}
      />
      {section > 0 ? (
        <VisualButton label="Sección anterior" secondary onPress={() => setSection(0)} />
      ) : null}
      <BodyText>Las selecciones solo modifican esta vista. No se guardan respuestas.</BodyText>
    </Screen>
  );
}
export function FormSummaryScreen() {
  return (
    <Screen title="Resumen de síntomas" backTo="/formulario">
      <DemoBadge />
      <BodyText>Resumen ficticio independiente de las selecciones anteriores.</BodyText>
      <InfoCard>
        <DetailRow label="Bienestar general" value="Ejemplo" />
        <DetailRow label="Observaciones" value="Ejemplo" />
      </InfoCard>
      <VisualButton label="Guardar respuestas · disponible más adelante" />
    </Screen>
  );
}
export function FormResultScreen() {
  return (
    <Screen title="Registro de síntomas" backTo="/formulario">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Presentación de confirmación</SectionTitle>
        <BodyText>No se registraron respuestas ni se enviaron datos al equipo de salud.</BodyText>
      </InfoCard>
      <VisualButton label="Volver al inicio" onPress={() => router.replace('/')} />
    </Screen>
  );
}
const styles = StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  progress: { fontSize: 14, fontWeight: '600', color: theme.colors.secondary },
  question: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
});
