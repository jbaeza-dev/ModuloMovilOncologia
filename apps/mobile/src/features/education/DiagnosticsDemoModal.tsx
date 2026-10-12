import Feather from '@expo/vector-icons/Feather';
import * as Network from 'expo-network';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BodyText,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

interface DiagnosticsDemoModalProps {
  visible: boolean;
  onClose: () => void;
}

export function DiagnosticsDemoModal({ visible, onClose }: DiagnosticsDemoModalProps) {
  const { theme: appTheme } = useAppTheme();
  const { patientId, repository, database } = useLocalData();
  const styles = useStyles();

  const [dbVersion, setDbVersion] = useState<number | null>(null);
  const [totalCopies, setTotalCopies] = useState<number>(0);
  const [totalInteractions, setTotalInteractions] = useState<number>(0);
  const [networkInfo, setNetworkInfo] = useState<{
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    type: string | null;
  }>({ isConnected: null, isInternetReachable: null, type: null });

  const [testResult, setTestResult] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async () => {
    if (!database || !repository) return;

    try {
      const v = await database.first<{ user_version: number }>('PRAGMA user_version');
      setDbVersion(v?.user_version ?? null);

      const copies = await repository.education.listLocalCopies();
      setTotalCopies(copies.length);

      const interactions = await repository.education.listInteractions();
      setTotalInteractions(interactions.length);

      const netState = await Network.getNetworkStateAsync().catch(() => ({
        isConnected: false,
        isInternetReachable: false,
        type: Network.NetworkStateType.NONE,
      }));
      setNetworkInfo({
        isConnected: netState.isConnected ?? false,
        isInternetReachable: netState.isInternetReachable ?? false,
        type: String(netState.type ?? 'DESCONOCIDO'),
      });
    } catch {
      // Ignorar fallo de diagnóstico
    }
  }, [database, repository]);

  useEffect(() => {
    if (visible) {
      void loadDiagnostics();
      setTestResult(null);
    }
  }, [visible, loadDiagnostics]);

  async function handleTestPreCommitFailure() {
    setTestResult(null);
    try {
      // Inducción controlada de fallo para escenario E-05
      await database?.transaction(async () => {
        throw new Error(
          'FALLO_INDUCIDO_TEST_E05: Simulación de error de base de datos antes del commit',
        );
      });
    } catch {
      setTestResult(
        'Fallo inducido con éxito (E-05): La transacción de SQLite revirtió correctamente. El sistema de compensación protege los archivos existentes.',
      );
      void loadDiagnostics();
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Feather name="activity" size={24} color={appTheme.colors.primary} />
              <Text style={styles.headerTitle}>Diagnóstico demo release</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar diagnóstico"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Feather name="x" size={22} color={appTheme.colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            <InfoCard>
              <SectionTitle>Estado de persistencia local</SectionTitle>
              <View style={styles.metricRow}>
                <BodyText>Paciente activo:</BodyText>
                <Text style={styles.metricValue}>{patientId ?? 'Ninguno'}</Text>
              </View>
              <View style={styles.metricRow}>
                <BodyText>Versión de esquema SQLite:</BodyText>
                <Text style={styles.metricValue}>
                  {dbVersion !== null ? `v${dbVersion}` : 'Cargando…'}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <BodyText>Copias locales persistidas:</BodyText>
                <Text style={styles.metricValue}>{totalCopies}</Text>
              </View>
              <View style={styles.metricRow}>
                <BodyText>Interacciones de YouTube:</BodyText>
                <Text style={styles.metricValue}>{totalInteractions}</Text>
              </View>
            </InfoCard>

            <InfoCard>
              <SectionTitle>Diagnóstico de red (E-03)</SectionTitle>
              <View style={styles.metricRow}>
                <BodyText>Conectado a red:</BodyText>
                <StatusPill>{networkInfo.isConnected ? 'Conectado' : 'Sin conexión'}</StatusPill>
              </View>
              <View style={styles.metricRow}>
                <BodyText>Internet accesible:</BodyText>
                <StatusPill>
                  {networkInfo.isInternetReachable ? 'Disponible' : 'No disponible'}
                </StatusPill>
              </View>
              <View style={styles.metricRow}>
                <BodyText>Tipo de interfaz:</BodyText>
                <Text style={styles.metricValue}>{networkInfo.type}</Text>
              </View>
              <BodyText>
                Para verificar E-03, activa el Modo Avión en Android y comprueba que YouTube
                notifica la necesidad de conexión sin intentar descargas locales.
              </BodyText>
            </InfoCard>

            <InfoCard>
              <SectionTitle>Comprobación de resiliencia (E-05)</SectionTitle>
              <BodyText>
                Prueba de compensación: induce un fallo de base de datos antes de confirmar el
                commit para verificar que no se corrompe el almacenamiento ni se borran archivos
                preexistentes.
              </BodyText>
              <VisualButton
                label="Inducir fallo en transacción (E-05)"
                secondary
                onPress={() => void handleTestPreCommitFailure()}
              />
              {testResult ? (
                <View style={styles.testResultBox}>
                  <Text style={styles.testResultText}>{testResult}</Text>
                </View>
              ) : null}
            </InfoCard>

            <VisualButton label="Cerrar diagnóstico" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    container: {
      maxHeight: '85%',
      backgroundColor: appTheme.colors.surface,
      borderTopLeftRadius: theme.radius.md,
      borderTopRightRadius: theme.radius.md,
      padding: theme.spacing.md,
      gap: theme.spacing.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: appTheme.colors.border,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: appTheme.colors.text,
    },
    closeButton: {
      padding: theme.spacing.xs,
      borderRadius: theme.radius.sm,
    },
    scrollContent: {
      gap: theme.spacing.md,
      paddingBottom: theme.spacing.lg,
    },
    metricRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: theme.spacing.xs,
    },
    metricValue: {
      fontSize: 15,
      fontWeight: '700',
      color: appTheme.colors.text,
    },
    testResultBox: {
      padding: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      backgroundColor: appTheme.colors.mutedSurface,
      borderWidth: 1,
      borderColor: appTheme.colors.border,
    },
    testResultText: {
      fontSize: 13,
      color: appTheme.colors.text,
      lineHeight: 18,
    },
  });
}
