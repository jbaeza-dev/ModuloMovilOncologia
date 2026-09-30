import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  DetailRow,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { formatDate, formatVital, type VitalRecord } from '../../data/local/repository';
import { useFocusedValue } from '../../data/local/use-local-query';
import { DEMO_PATIENTS, useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { isDemoMode } from '../../utils/environment';

export function HomeScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { repository, patientId, changePatient, saving } = useLocalData();
  const load = useCallback(
    () => (repository ? repository.latestVital() : Promise.resolve(null)),
    [repository],
  );
  const {
    value: latest,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, null as VitalRecord | null);
  return (
    <Screen showProfile>
      <View style={styles.introduction}>
        <Text style={styles.eyebrow}>ACOMPAÑAMIENTO EN QUIMIOTERAPIA</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Hola, te damos la bienvenida
        </Text>
        <Text style={styles.description}>Un espacio para tu seguimiento y cuidado diario.</Text>
      </View>
      {isDemoMode() ? (
        <InfoCard>
          <BodyText>
            Datos sintéticos · {DEMO_PATIENTS.find((patient) => patient.id === patientId)?.label}
          </BodyText>
          <VisualButton
            label="Cambiar paciente de prueba"
            secondary
            disabled={saving}
            onPress={changePatient}
          />
        </InfoCard>
      ) : null}
      <View style={styles.section}>
        <SectionTitle>Tu seguimiento</SectionTitle>
        {loading || error || !latest ? (
          <InfoCard>
            <Text style={styles.cardTitle}>
              {loading
                ? 'Cargando registros'
                : error
                  ? 'No se pudo leer el último registro'
                  : 'Aún no hay registros'}
            </Text>
            <Text style={styles.description}>
              {error
                ? 'Reintenta la consulta local.'
                : 'Tus mediciones aparecerán aquí después de guardarlas.'}
            </Text>
            {error ? <VisualButton label="Reintentar" onPress={refresh} /> : null}
          </InfoCard>
        ) : (
          <InfoCard>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>Último registro</Text>
              <StatusPill>Pendiente de envío</StatusPill>
            </View>
            <DetailRow label="Fecha" value={formatDate(latest.fecha_registro)} />
            <DetailRow label="Temperatura" value={formatVital(latest.temperatura, '°C')} />
            <DetailRow label="Pulso" value={formatVital(latest.pulso, 'lpm')} />
            <Text style={styles.helper}>
              Datos sintéticos locales; no representan una evaluación clínica.
            </Text>
          </InfoCard>
        )}
        <NavigationCard
          title="Registrar signos vitales"
          description="Guarda mediciones en este dispositivo."
          icon="activity"
          href="/vitales/registrar"
          primary
        />
        <NavigationCard
          title="Síntomas de hoy"
          description="Guarda una descripción de síntomas."
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
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
    },
    cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
    helper: { fontSize: 12, lineHeight: 18, color: colors.secondary },
  });
}
