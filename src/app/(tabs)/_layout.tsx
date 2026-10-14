import { Tabs, router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type PressableStateCallbackType } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { SidebarBreakpoint, SidebarWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const TABS = [
  { name: 'index', title: 'Hoy', icon: '🏠' },
  { name: 'routines', title: 'Rutinas', icon: '🏋️' },
  { name: 'history', title: 'Historial', icon: '📅' },
  { name: 'stats', title: 'Progreso', icon: '📈' },
  { name: 'weight', title: 'Peso', icon: '⚖️' },
];

type PressState = PressableStateCallbackType & { hovered?: boolean };

export default function TabsLayout() {
  const colors = useTheme();
  const wide = useWindowDimensions().width >= SidebarBreakpoint;

  return (
    <Tabs
      tabBar={wide ? (props) => <Sidebar {...props} /> : undefined}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontWeight: 600 },
        tabBarStyle: { backgroundColor: colors.backgroundElement, borderTopColor: colors.border },
      }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ title: t.title, tabBarIcon: () => <Text style={{ fontSize: 20 }}>{t.icon}</Text> }}
        />
      ))}
    </Tabs>
  );
}

/** Desktop navigation: a fixed column with the brand, the tabs and a link to Ajustes. */
function Sidebar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  return (
    <View style={[styles.sidebar, { backgroundColor: theme.backgroundElement, borderRightColor: theme.border }]}>
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: theme.accent }]}>
          <Text style={styles.logoText}>P</Text>
        </View>
        <ThemedText style={styles.brandName}>Plitt Fit</ThemedText>
      </View>

      <View style={{ gap: 4 }}>
        {state.routes.map((route, index) => {
          const tab = TABS.find((t) => t.name === route.name);
          const focused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <NavItem
              key={route.key}
              icon={tab?.icon ?? '•'}
              label={tab?.title ?? route.name}
              focused={focused}
              onPress={onPress}
            />
          );
        })}
      </View>

      <View style={{ flex: 1 }} />
      <NavItem icon="⚙️" label="Ajustes" onPress={() => router.push('/settings')} />
    </View>
  );
}

function NavItem({ icon, label, focused, onPress }: { icon: string; label: string; focused?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      style={(s) => [
        styles.item,
        {
          backgroundColor: focused ? theme.accentSoft : (s as PressState).hovered ? theme.backgroundSelected : 'transparent',
        },
      ]}>
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <ThemedText style={{ fontWeight: focused ? 700 : 600, color: focused ? theme.tint : theme.textSecondary }}>
        {label}
      </ThemedText>
      {focused ? <View style={[styles.indicator, { backgroundColor: theme.tint }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SidebarWidth,
    borderRightWidth: 1,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.two },
  logo: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontWeight: 800, fontSize: 18 },
  brandName: { fontSize: 20, fontWeight: 800, letterSpacing: -0.4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  indicator: { position: 'absolute', left: -12, top: 10, bottom: 10, width: 3, borderRadius: 3 },
});
