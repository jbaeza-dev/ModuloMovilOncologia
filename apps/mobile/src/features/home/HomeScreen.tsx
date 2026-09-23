import { StyleSheet, Text, View } from 'react-native';

import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import { theme } from '../../theme';

export function HomeScreen() {
  return (
    <Screen showProfile>
      <View style={styles.introduction}>
        <Text style={styles.eyebrow}>ACOMPAÑAMIENTO EN QUIMIOTERAPIA</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Hola, te damos la bienvenida
        </Text>
        <Text style={styles.description}>Un espacio para tu seguimiento y cuidado diario.</Text>
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Tu seguimiento
        </Text>
        <NavigationCard
          title="Registrar signos vitales"
          description="Accede al registro de tus mediciones."
          icon="activity"
          href="/vitales/registrar"
          primary
        />
        <NavigationCard
          title="Síntomas de hoy"
          description="Accede al formulario de síntomas."
          icon="clipboard"
          href="/formulario"
        />
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Acompañamiento
        </Text>
        <NavigationCard
          title="Asistente QuimioCare"
          description="Conoce el espacio de orientación."
          icon="message-circle"
          href="/asistente"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  introduction: { gap: theme.spacing.sm },
  eyebrow: { fontSize: 12, fontWeight: '600', letterSpacing: 1, color: theme.colors.secondary },
  title: { fontSize: 30, fontWeight: '700', color: theme.colors.text },
  description: { fontSize: 16, lineHeight: 24, color: theme.colors.secondary },
  section: { gap: theme.spacing.md },
  sectionTitle: { fontSize: 19, fontWeight: '600', color: theme.colors.text },
});
