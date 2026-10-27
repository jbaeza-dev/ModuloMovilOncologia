import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../components/Screen';
import { BodyText, InfoCard } from '../../../components/Visual';
import { runNativeLab } from './native-lab';

export default function P04ProbeScreen() {
  const params = useLocalSearchParams<{
    run?: string;
    action?: string;
    patient?: string;
    phase?: string;
  }>();
  const [result, setResult] = useState('Preparando caso nativo aislado…');
  useEffect(() => {
    let active = true;
    if (!params.run || !params.action) {
      setResult('Indica un caso de laboratorio válido.');
      return;
    }
    void runNativeLab({
      run: params.run,
      action: params.action,
      patient: params.patient === 'B' ? 'B' : 'A',
      phase: params.phase,
    }).then(
      (r) => {
        if (active) setResult(JSON.stringify(r, null, 2));
      },
      () => {
        if (active) setResult('No se pudo iniciar el laboratorio.');
      },
    );
    return () => {
      active = false;
    };
  }, [params.run, params.action, params.patient, params.phase]);
  return (
    <Screen title="Diagnóstico técnico P04">
      <InfoCard>
        <BodyText>Solo copias sintéticas. No ejecuta la migración de la base original.</BodyText>
        <BodyText>{result}</BodyText>
      </InfoCard>
    </Screen>
  );
}
