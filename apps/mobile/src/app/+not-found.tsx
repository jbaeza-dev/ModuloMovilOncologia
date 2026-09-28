import { Text } from 'react-native';

import { Screen } from '../components/Screen';
import { NavigationCard } from '../components/NavigationCard';
import { useAppTheme } from '../providers/ThemeProvider';

export default function NotFoundScreen() {
  const { theme } = useAppTheme();
  return (
    <Screen title="Página no encontrada">
      <Text style={{ color: theme.colors.secondary, fontSize: 17, lineHeight: 26 }}>
        La dirección que abriste no está disponible.
      </Text>
      <NavigationCard title="Volver al inicio" icon="home" href="/" replace />
    </Screen>
  );
}
