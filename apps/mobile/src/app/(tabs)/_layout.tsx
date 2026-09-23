import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../../theme';

export const unstable_settings = { initialRouteName: '(inicio)' };

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return (
    <Tabs
      initialRouteName="(inicio)"
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.text,
        tabBarInactiveTintColor: theme.colors.secondary,
        tabBarActiveBackgroundColor: theme.colors.mutedSurface,
        tabBarLabelPosition: 'below-icon',
        tabBarAllowFontScaling: true,
        tabBarLabel: ({ color, children }) => (
          <Text style={[styles.label, { color }]}>{children}</Text>
        ),
        tabBarItemStyle: styles.item,
        tabBarStyle: [styles.bar, { height: 76 + 36 * Math.max(0, fontScale - 1) + insets.bottom }],
      }}
    >
      <Tabs.Screen
        name="(inicio)"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <Feather name="home" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vitales"
        options={{
          title: 'Vitales',
          tabBarIcon: ({ color }) => <Feather name="activity" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="formulario"
        options={{
          title: 'Formulario',
          tabBarIcon: ({ color }) => <Feather name="clipboard" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="educacion"
        options={{
          title: 'Educación',
          tabBarIcon: ({ color }) => <Feather name="book-open" size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: theme.colors.background,
    borderTopColor: theme.colors.border,
    elevation: 0,
  },
  item: { minHeight: 64, paddingVertical: 8 },
  label: { fontSize: 12, fontWeight: '600', textAlign: 'center', paddingHorizontal: 2 },
});
