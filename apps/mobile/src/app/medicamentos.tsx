import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../components/Screen';
import { MedicationDaySection } from '../features/home/MedicationDaySection';
export default function MedicationConfirmationsScreen() {
  const { medicamentoId } = useLocalSearchParams<{ medicamentoId?: string }>();
  return (
    <Screen title="Registro de medicamentos" mascotPose="recordatorio">
      <MedicationDaySection
        medicamentoId={typeof medicamentoId === 'string' ? medicamentoId : undefined}
      />
    </Screen>
  );
}
