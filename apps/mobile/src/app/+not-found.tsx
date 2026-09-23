import { StyleSheet, Text } from 'react-native';

import { Screen } from '../components/Screen';
import { NavigationCard } from '../components/NavigationCard';
import { theme } from '../theme';

export default function NotFoundScreen() {
  return (
    <Screen title="Página no encontrada">
      <Text style={styles.description}>La dirección que abriste no está disponible.</Text>
      <NavigationCard title="Volver al inicio" icon="home" href="/" replace />
    </Screen>
  );
}

const styles = StyleSheet.create({
  description: { color: theme.colors.secondary, fontSize: 17, lineHeight: 26 },
});
