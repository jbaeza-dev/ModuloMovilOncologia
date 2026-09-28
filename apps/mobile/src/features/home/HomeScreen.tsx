import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import { DemoBadge, DetailRow, InfoCard, SectionTitle, StatusPill } from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

export function HomeScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { vista } = useLocalSearchParams<{ vista?: string }>();
  const empty = vista === 'vacia';
  return (
    <Screen showProfile>
      <View style={styles.introduction}>
        <Text style={styles.eyebrow}>ACOMPAÑAMIENTO EN QUIMIOTERAPIA</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Hola, te damos la bienvenida
        </Text>
        <Text style={styles.description}>Un espacio para tu seguimiento y cuidado diario.</Text>
      </View>
      <DemoBadge />
      <View style={styles.section}>
        <SectionTitle>Tu seguimiento</SectionTitle>
        {empty ? (
          <InfoCard>
            <Text style={styles.cardTitle}>Aún no hay registros</Text>
            <Text style={styles.description}>
              Tus mediciones aparecerán aquí cuando se incorporen los registros.
            </Text>
          </InfoCard>
        ) : (
          <InfoCard>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>Último registro</Text>
              <StatusPill>Ejemplo</StatusPill>
            </View>
            <DetailRow label="Fecha" value="12 de septiembre · 09:40" />
            <DetailRow label="Temperatura" value="36,8 °C" />
            <DetailRow label="Pulso" value="72 lpm" />
            <Text style={styles.helper}>
              Los valores son ficticios y no representan una evaluación clínica.
            </Text>
          </InfoCard>
        )}
        <NavigationCard
          title="Registrar signos vitales"
          description="Vista del registro de mediciones."
          icon="activity"
          href="/vitales/registrar"
          primary
        />
        <NavigationCard
          title="Síntomas de hoy"
          description="Vista del formulario de síntomas."
          icon="clipboard"
          href="/formulario"
        />
      </View>
      <View style={styles.section}>
        <SectionTitle>Acompañamiento</SectionTitle>
        <NavigationCard
          title="Asistente QuimioCare"
          description="Espacio de orientación visual."
          icon="message-circle"
          href="/asistente"
        />
        {__DEV__ ? (
          <NavigationCard
            title="Galería de revisión"
            description="Todas las pantallas y variantes del prototipo."
            icon="grid"
            href="/galeria"
          />
        ) : null}
      </View>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    introduction: { gap: theme.spacing.sm },
    eyebrow: { fontSize: 12, fontWeight: '600', letterSpacing: 1, color: colors.secondary },
    title: { fontSize: 30, fontWeight: '700', color: colors.text },
    description: { fontSize: 16, lineHeight: 24, color: colors.secondary },
    section: { gap: theme.spacing.md },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
    helper: { fontSize: 12, lineHeight: 18, color: colors.secondary },
  });
}
