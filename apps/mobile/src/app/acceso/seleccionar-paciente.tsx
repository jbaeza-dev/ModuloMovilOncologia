import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ContextGuard } from '../../components/ContextGuard';
import { Screen } from '../../components/Screen';
import { BodyText, DemoBadge, InfoCard, VisualButton } from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

export default function SeleccionarPacienteScreen() {
  const { isClosing, selectPatient, patientId } = useLocalData();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);

  const handleSelect = async (id: string) => {
    setErrorMsg(null);
    try {
      await selectPatient(id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen title="Seleccionar paciente" backTo="/acceso">
      <DemoBadge />

      {errorMsg ? (
        <InfoCard>
          <Text accessibilityRole="alert" style={styles.errorHeader}>
            Error al seleccionar paciente
          </Text>
          <BodyText>{errorMsg}</BodyText>
          <VisualButton label="Aceptar" secondary onPress={() => setErrorMsg(null)} />
        </InfoCard>
      ) : null}

      <ContextGuard
        isClosing={isClosing}
        onSelectPatient={handleSelect}
        selectedPatientId={patientId}
      />

      <View style={styles.footerNote}>
        <BodyText>
          Cada paciente de demostración mantiene sus propios registros clínicos, consentimientos,
          copias y reglas de recordatorios aislados en la base de datos local.
        </BodyText>
      </View>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    errorHeader: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.primary,
      marginBottom: theme.spacing.xs,
    },
    footerNote: {
      marginTop: theme.spacing.lg,
    },
  });
}
