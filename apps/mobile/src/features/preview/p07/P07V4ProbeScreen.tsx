import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../components/Screen';
import { BodyText, InfoCard } from '../../../components/Visual';
import { runP07V4Probe } from './v4-native-probe';
export default function P07V4ProbeScreen() {
  const { run, action } = useLocalSearchParams<{ run?: string; action?: string }>();
  const [result, setResult] = useState('Preparando comprobación aislada…');
  useEffect(() => {
    let active = true;
    if (!run || !['migration', 'orientation', 'reports', 'sdk'].includes(action ?? '')) {
      setResult('Indica una prueba válida.');
      return;
    }
    setResult('Ejecutando comprobación aislada…');
    void runP07V4Probe(run, action as 'migration' | 'orientation' | 'reports' | 'sdk').then(
      (value) => {
        if (active) setResult(JSON.stringify(value, null, 2));
      },
      () => {
        if (active) setResult('La comprobación no pudo iniciarse.');
      },
    );
    return () => {
      active = false;
    };
  }, [run, action]);
  return (
    <Screen title="Laboratorio P07 v0.5">
      <InfoCard>
        <BodyText>
          Solo datos sintéticos. Esta instalación no abre las bases de la aplicación original.
        </BodyText>
        <BodyText>{result}</BodyText>
      </InfoCard>
    </Screen>
  );
}
