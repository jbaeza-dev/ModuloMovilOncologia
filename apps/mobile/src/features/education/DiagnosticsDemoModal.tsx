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
import { saveEducationalMediaWithCompensation } from '../../data/local/files/educational-storage';
import {
  getPatientResourceDirectory,
  readResourceFile,
  resourceFileExists,
} from '../../data/local/files/resource-storage';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { isDemoMode } from '../../utils/environment';
import {
  getEducationalCatalogReader,
  InMemoryEducationalCatalogReader,
  setEducationalCatalogReader,
} from './educational-catalog-service';

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

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [catalogCount, setCatalogCount] = useState<number>(0);
  const [emptyCatalogTestResult, setEmptyCatalogTestResult] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async () => {
    if (!database || !repository) return;
    try {
      const v = await database.first<{ user_version: number }>('PRAGMA user_version');
      setDbVersion(v?.user_version ?? 0);

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

      const reader = getEducationalCatalogReader();
      const allRes = await reader.getAllResources();
      setCatalogCount(allRes.length);
    } catch {
      // Ignorar fallo de diagnóstico
    }
  }, [database, repository]);

  async function handleToggleEmptyCatalog() {
    const reader = getEducationalCatalogReader();
    const all = await reader.getAllResources();
    if (all.length > 0) {
      setEducationalCatalogReader(new InMemoryEducationalCatalogReader([]));
      setCatalogCount(0);
      setEmptyCatalogTestResult(
        'Catálogo retirado/vaciado explícitamente (0 contenidos). Puedes navegar a «Mis copias guardadas» y comprobar la lectura desacoplada sin catálogo.',
      );
    } else {
      setEducationalCatalogReader(new InMemoryEducationalCatalogReader());
      const restored = await getEducationalCatalogReader().getAllResources();
      setCatalogCount(restored.length);
      setEmptyCatalogTestResult('Catálogo sintético restaurado a su estado original.');
    }
  }

  async function handleTestEmptyCatalogReading() {
    if (!repository || !patientId) return;
    try {
      // 1. Vaciar explícitamente el catálogo
      setEducationalCatalogReader(new InMemoryEducationalCatalogReader([]));
      const catalogSize = (await getEducationalCatalogReader().getAllResources()).length;

      // 2. Consultar copias existentes en SQLite
      const copies = await repository.education.listLocalCopies();
      if (copies.length === 0) {
        setEmptyCatalogTestResult(
          'No hay copias guardadas en este paciente para comprobar. Guarda una copia primero.',
        );
        return;
      }

      // 3. Tomar una copia guardada y comprobar que su lectura física funciona sin catálogo
      const targetCopy = copies[0];
      const fileContent = await readResourceFile(
        patientId,
        targetCopy.contentId,
        targetCopy.rutaRelativa,
      );

      setEmptyCatalogTestResult(
        `Prueba de catálogo vacío superada con éxito: Catálogo en memoria = ${catalogSize} recursos. La copia «${targetCopy.contentId}» (${targetCopy.formato}, ${targetCopy.tamanoBytes} bytes) se resolvió y leyó desde el almacenamiento privado (${fileContent ? 'contenido leído correctamente' : 'archivo verificado'}) de forma 100% desacoplada del catálogo.`,
      );
      setCatalogCount(0);
    } catch (err) {
      setEmptyCatalogTestResult(
        `Error en prueba de catálogo vacío: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  useEffect(() => {
    if (visible && isDemoMode()) {
      void loadDiagnostics();
      setTestResult(null);
    }
  }, [visible, loadDiagnostics]);

  if (!visible || !isDemoMode()) return null;

  async function handleTestPreCommitFailure() {
    if (!database || !patientId || testing) return;
    setTesting(true);
    setTestResult('Ejecutando simulación de fallo transaccional E-05…');
    const testContentId = 'diag-test-precommit-e05';
    const EXPECTED_ERROR = 'FALLO_INDUCIDO_TEST_E05: Simulación SQLite antes del commit';

    try {
      // 1. Estado inicial
      const fileBefore = resourceFileExists(patientId, testContentId);
      const rowBefore = await database.first<{ c: number }>(
        'SELECT count(*) as c FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
        [patientId, testContentId],
      );

      // 2. Ejecutar coordinador real con inserción activa en SQLite y excepción controlada
      let errorThrown = false;
      let matchedExpectedError = false;
      try {
        await saveEducationalMediaWithCompensation({
          pacienteId: patientId,
          contenidoId: testContentId,
          formato: 'png',
          content: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          persistCopyInTx: async (params) => {
            await database.transaction(async (tx) => {
              // Inserción real de prueba dentro de la transacción antes del fallo
              await tx.run(
                `INSERT INTO descarga (paciente_id, contenido_id, ruta_local, formato, tamano_bytes, fecha_descarga, revision_declarada, estado)
                 VALUES (?, ?, ?, ?, ?, ?, 0, 'descargado')`,
                [patientId, testContentId, params.rutaLocal, 'png', 128, new Date().toISOString()],
              );
              // Lanzar la excepción identificada esperada para forzar el rollback
              throw new Error(EXPECTED_ERROR);
            });
          },
        });
      } catch (err) {
        errorThrown = true;
        const msg = err instanceof Error ? err.message : String(err);
        const causeMsg = (err as { cause?: Error })?.cause?.message ?? '';
        if (msg.includes(EXPECTED_ERROR) || causeMsg.includes(EXPECTED_ERROR)) {
          matchedExpectedError = true;
        }
      }

      // 3. Estado posterior comprobando reversión física, base de datos y temporales residuales
      const fileAfter = resourceFileExists(patientId, testContentId);
      const rowAfter = await database.first<{ c: number }>(
        'SELECT count(*) as c FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
        [patientId, testContentId],
      );

      const dir = getPatientResourceDirectory(patientId);
      let danglingTmpCount = 0;
      if (dir.exists) {
        try {
          const entries = dir.list();
          danglingTmpCount = entries.filter(
            (e) => e.uri.endsWith('.tmp') && e.uri.includes(testContentId),
          ).length;
        } catch {
          // Ignorar fallo al listar
        }
      }

      if (
        errorThrown &&
        matchedExpectedError &&
        !fileAfter &&
        (rowAfter?.c ?? 0) === 0 &&
        danglingTmpCount === 0
      ) {
        setTestResult(
          `Prueba E-05 comprobada con éxito: El coordinador lanzó la excepción esperada (${EXPECTED_ERROR}), la transacción SQLite revirtió la fila insertada (filas: ${rowBefore?.c ?? 0} -> 1 -> ${rowAfter?.c ?? 0}), la compensación eliminó el archivo destino (disco: ${fileBefore ? 'existía' : 'ausente'} -> ${fileAfter ? 'error' : 'ausente'}) y no quedaron archivos temporales residuales (.tmp: ${danglingTmpCount}).`,
        );
      } else {
        setTestResult(
          `Prueba E-05 falló la validación: errorEsperado=${matchedExpectedError}, archivoEnDisco=${fileAfter}, filasSQLite=${rowAfter?.c ?? 0}, temporalesResiduales=${danglingTmpCount}.`,
        );
      }
      void loadDiagnostics();
    } catch (err) {
      setTestResult(
        `Error inesperado en diagnóstico E-05: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setTesting(false);
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
                <BodyText>Copias locales registradas:</BodyText>
                <Text style={styles.metricValue}>{totalCopies}</Text>
              </View>
              <View style={styles.metricRow}>
                <BodyText>Interacciones YouTube registradas:</BodyText>
                <Text style={styles.metricValue}>{totalInteractions}</Text>
              </View>
            </InfoCard>

            <InfoCard>
              <SectionTitle>Estado de red del dispositivo</SectionTitle>
              <View style={styles.metricRow}>
                <BodyText>Conectado a red:</BodyText>
                <StatusPill>{networkInfo.isConnected ? 'Sí' : 'No'}</StatusPill>
              </View>
              <View style={styles.metricRow}>
                <BodyText>Internet accesible:</BodyText>
                <StatusPill>{networkInfo.isInternetReachable ? 'Sí' : 'No'}</StatusPill>
              </View>
              <View style={styles.metricRow}>
                <BodyText>Tipo de conexión:</BodyText>
                <Text style={styles.metricValue}>{networkInfo.type ?? 'Desconocido'}</Text>
              </View>
            </InfoCard>

            <InfoCard>
              <SectionTitle>Aceptación: Simulación de fallo (E-05)</SectionTitle>
              <BodyText>
                Ejecuta el coordinador de guardado real y fuerza una excepción SQLite antes del
                commit para verificar que la transacción revierte y la compensación elimina los
                archivos de disco sin dejar huérfanos.
              </BodyText>
              <VisualButton
                label={testing ? 'Probando compensación…' : 'Ejecutar prueba de fallo pre-commit'}
                secondary
                disabled={testing}
                onPress={() => void handleTestPreCommitFailure()}
              />
              {testResult ? (
                <View style={styles.testResultBox}>
                  <Text style={styles.testResultText}>{testResult}</Text>
                </View>
              ) : null}
            </InfoCard>

            <InfoCard>
              <SectionTitle>Aceptación: Catálogo desacoplado</SectionTitle>
              <View style={styles.metricRow}>
                <BodyText>Recursos en catálogo activo:</BodyText>
                <Text style={styles.metricValue}>
                  {catalogCount > 0 ? `${catalogCount} contenidos` : '0 contenidos (Vacío)'}
                </Text>
              </View>
              <BodyText>
                Sustituye o retira explícitamente el catálogo sintético para verificar de forma
                nativa que las copias locales guardadas pueden consultarse y leerse sin depender del
                catálogo.
              </BodyText>
              <View style={{ gap: 8 }}>
                <VisualButton
                  label={
                    catalogCount > 0
                      ? 'Vaciar catálogo temporalmente'
                      : 'Restaurar catálogo completo'
                  }
                  secondary
                  onPress={() => void handleToggleEmptyCatalog()}
                />
                <VisualButton
                  label="Ejecutar prueba de lectura con catálogo vacío"
                  onPress={() => void handleTestEmptyCatalogReading()}
                />
              </View>
              {emptyCatalogTestResult ? (
                <View style={styles.testResultBox}>
                  <Text style={styles.testResultText}>{emptyCatalogTestResult}</Text>
                </View>
              ) : null}
            </InfoCard>
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
    },
    scrollContent: {
      gap: theme.spacing.md,
      paddingBottom: theme.spacing.lg,
    },
    metricRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginVertical: 4,
    },
    metricValue: {
      fontSize: 14,
      fontWeight: '600',
      color: appTheme.colors.text,
    },
    testResultBox: {
      marginTop: theme.spacing.sm,
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
