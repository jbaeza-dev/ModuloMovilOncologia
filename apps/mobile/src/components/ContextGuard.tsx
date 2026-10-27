import { Text, View, StyleSheet } from 'react-native';

import { BodyText, InfoCard, VisualButton } from './Visual';
import { DEMO_PATIENTS } from '../providers/LocalDataProvider';
import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

interface ContextGuardProps {
  isClosing: boolean;
  onSelectPatient: (patientId: string) => Promise<void> | void;
  selectedPatientId?: string | null;
}

export function ContextGuard({ isClosing, onSelectPatient, selectedPatientId }: ContextGuardProps) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);

  return (
    <View style={styles.container}>
      {isClosing ? (
        <InfoCard>
          <Text accessibilityRole="alert" style={styles.closingHeader}>
            Cerrando contexto anterior…
          </Text>
          <BodyText>
            Finalizando operaciones atómicas y cancelando la agenda del paciente previo. La
            selección se habilitará en breve.
          </BodyText>
        </InfoCard>
      ) : (
        <InfoCard>
          <Text style={styles.header}>Selecciona un paciente de prueba</Text>
          <BodyText>
            Accede al simulador con una cuenta sintética. Sus capturas locales se mantienen
            separadas. Este acceso de demostración requiere el servicio configurado y no reproduce
            Google central.
          </BodyText>
        </InfoCard>
      )}

      <View style={styles.buttonList}>
        {DEMO_PATIENTS.map((patient) => {
          const isSelected = selectedPatientId === patient.id;
          return (
            <VisualButton
              key={patient.id}
              label={isSelected ? `${patient.label} (Activo)` : patient.label}
              disabled={isClosing}
              secondary={isSelected}
              onPress={() => void onSelectPatient(patient.id)}
            />
          );
        })}
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      gap: theme.spacing.md,
      marginVertical: theme.spacing.md,
    },
    header: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: theme.spacing.xs,
    },
    closingHeader: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.primary,
      marginBottom: theme.spacing.xs,
    },
    buttonList: {
      gap: theme.spacing.sm,
    },
  });
}
