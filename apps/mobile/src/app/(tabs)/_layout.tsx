import { AppIcon as Feather } from '../../components/AppIcon';
import { Tabs } from 'expo-router';
import { StackActions } from 'expo-router/react-navigation';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PodcastMiniPlayer } from '../../components/PodcastMiniPlayer';
import { ScreenBottomInsetHandledContext } from '../../components/ScreenInsets';
import { requestHomeScrollToTop } from '../../features/home/home-scroll-signal';
import { useAppTheme } from '../../providers/ThemeProvider';

export const unstable_settings = { initialRouteName: '(inicio)' };

export type TabNavigatorLikeState = {
  routes?: Array<{
    name: string;
    state?: {
      key?: string;
      index?: number;
      routes?: unknown[];
    };
  }>;
};

export function handleHomeTabPress(navigation: {
  getState: () => TabNavigatorLikeState | undefined;
  dispatch: (action: unknown) => void;
}): void {
  const tabState = navigation.getState();
  const homeTabRoute = tabState?.routes?.find((r) => r.name === '(inicio)');
  const homeStackState = homeTabRoute?.state;
  const homeStackKey = homeStackState?.key;
  const hasSecondaryScreens =
    Boolean(homeStackKey) &&
    ((typeof homeStackState?.index === 'number' && homeStackState.index > 0) ||
      (Array.isArray(homeStackState?.routes) && homeStackState.routes.length > 1));

  if (hasSecondaryScreens && homeStackKey) {
    navigation.dispatch({
      ...StackActions.popToTop(),
      target: homeStackKey,
    });
  }
  requestHomeScrollToTop();
}

export default function TabsLayout() {
  const { theme: appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const compactLabels = width < 400 && fontScale >= 1.2;
  const tabHeight = 76 + 56 * Math.max(0, fontScale - 1) + insets.bottom;

  const styles = StyleSheet.create({
    bar: {
      backgroundColor: appTheme.colors.background,
      borderTopColor: appTheme.colors.border,
      elevation: 0,
    },
    item: { minHeight: 64, paddingVertical: 8 },
    label: {
      width: '100%',
      flexShrink: 1,
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'center',
      paddingHorizontal: 2,
    },
  });

  return (
    <View style={{ flex: 1 }}>
      <ScreenBottomInsetHandledContext.Provider value>
        <Tabs
          initialRouteName="(inicio)"
          backBehavior="fullHistory"
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: appTheme.colors.primary,
            tabBarInactiveTintColor: appTheme.colors.secondary,
            tabBarActiveBackgroundColor: appTheme.colors.primaryContainer,
            tabBarLabelPosition: 'below-icon',
            tabBarAllowFontScaling: true,
            tabBarLabel: ({ color, children }) => (
              <Text numberOfLines={2} style={[styles.label, { color }]}>
                {compactLabels && children === 'Formulario'
                  ? 'Formu\nlario'
                  : compactLabels && children === 'Educación'
                    ? 'Educa\nción'
                    : children}
              </Text>
            ),
            tabBarItemStyle: styles.item,
            tabBarStyle: [styles.bar, { height: tabHeight }],
          }}
        >
          <Tabs.Screen
            name="(inicio)"
            options={{
              title: 'Inicio',
              tabBarIcon: ({ color }) => <Feather name="home" size={24} color={color} />,
            }}
            listeners={({ navigation }) => ({
              tabPress: () => {
                handleHomeTabPress(navigation);
              },
            })}
          />
          <Tabs.Screen
            name="vitales"
            options={{
              title: 'Mediciones',
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
      </ScreenBottomInsetHandledContext.Provider>
      <PodcastMiniPlayer bottomOffset={tabHeight} />
    </View>
  );
}
