import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { Screen } from '../../components/Screen';
import { BodyText, DetailRow, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import {
  clearAllPatientReports,
  getPatientReportList,
} from '../../data/local/files/report-storage';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { EducationStatusRevisionContext } from '../../providers/QueryRevision';
import {
  EDUCATION_MAX_COPIES,
  EDUCATION_MAX_MEGABYTES,
} from '../education/education-storage-limits';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StorageManagementScreen() {
  const { patientId, repository, trackOperation } = useLocalData();
  const [cleaningReports, setCleaningReports] = useState(false);

  const loadStorageInfo = useCallback(async () => {
    if (!patientId || !repository) {
      return {
        reportsCount: 0,
        reportsBytes: 0,
        copiesCount: 0,
        copiesBytes: 0,
      };
    }

    const reports = await getPatientReportList(patientId);
    const reportsBytes = reports.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);

    const copies = await repository.education.listLocalCopies();
    const activeCopies = copies.filter((c) => c.estado === 'descargado' && !c.retiradoEn);
    const copiesBytes = activeCopies.reduce((sum, c) => sum + (c.tamanoBytes || 0), 0);

    return {
      reportsCount: reports.length,
      reportsBytes,
      copiesCount: activeCopies.length,
      copiesBytes,
    };
  }, [patientId, repository]);

  const { value: storageInfo, refresh } = useFocusedValue(
    loadStorageInfo,
    {
      reportsCount: 0,
      reportsBytes: 0,
      copiesCount: 0,
      copiesBytes: 0,
    },
    {
      queryKey: `${patientId ?? 'default'}:storage:info`,
      context: EducationStatusRevisionContext,
    },
  );

  const handleClearReports = () => {
    if (!patientId) return;

    Alert.alert(
      '¿Eliminar reportes generados?',
      'Esta acción eliminará los archivos de resumen clínico (PDF y Excel) guardados en este teléfono. No afecta tus registros médicos ni tus guías educativas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar reportes',
          style: 'destructive',
          onPress: async () => {
            setCleaningReports(true);
            try {
              await trackOperation(async () => {
                await clearAllPatientReports(patientId);
              });
              await refresh();
            } catch {
              Alert.alert('Error', 'No se pudieron eliminar todos los reportes.');
            } finally {
              setCleaningReports(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen mascotPose="resumen" title="Almacenamiento">
      <SectionTitle>Uso de memoria local</SectionTitle>
      <InfoCard>
        <DetailRow
          label="Espacio total estimado"
          value={formatBytes((storageInfo?.reportsBytes || 0) + (storageInfo?.copiesBytes || 0))}
        />
      </InfoCard>

      <SectionTitle>Reportes clínicos generados</SectionTitle>
      <InfoCard>
        <DetailRow
          label="Archivos generados"
          value={`${storageInfo?.reportsCount ?? 0} reportes (${formatBytes(storageInfo?.reportsBytes ?? 0)})`}
        />
        <BodyText>
          Los reportes PDF y Excel descargados se guardan localmente para que puedas consultarlos
          sin conexión. Puedes borrarlos en cualquier momento sin perder tus datos de salud.
        </BodyText>
        <VisualButton
          label={cleaningReports ? 'Limpiando…' : 'Limpiar reportes generados'}
          disabled={cleaningReports || (storageInfo?.reportsCount ?? 0) === 0}
          onPress={handleClearReports}
        />
      </InfoCard>

      <SectionTitle>Guías educativas descargadas</SectionTitle>
      <InfoCard>
        <DetailRow
          label="Guías guardadas"
          value={`${storageInfo?.copiesCount ?? 0} guías (${formatBytes(storageInfo?.copiesBytes ?? 0)})`}
        />
        <BodyText>
          Las guías educativas que marcas para conservar offline o que se preparan automáticamente.
        </BodyText>
        <VisualButton
          label="Administrar guías educativas"
          secondary
          onPress={() => router.push('/educacion/copias')}
        />
      </InfoCard>

      <SectionTitle>Regulación automática de cuota</SectionTitle>
      <InfoCard>
        <BodyText>
          QuimioCare regula automáticamente las guías descargadas para no sobrecargar tu teléfono
          (límite: {EDUCATION_MAX_COPIES} guías o {EDUCATION_MAX_MEGABYTES} MB). Las guías que no
          hayas consultado recientemente se liberan solas cuando se alcanza el límite, a menos que
          elijas conservarlas.
        </BodyText>
      </InfoCard>
    </Screen>
  );
}
