import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

const TABS = [
  { name: 'index', title: 'Hoy', icon: '🏠' },
  { name: 'routines', title: 'Rutinas', icon: '🏋️' },
  { name: 'history', title: 'Historial', icon: '📅' },
  { name: 'stats', title: 'Progreso', icon: '📈' },
  { name: 'weight', title: 'Peso', icon: '⚖️' },
];

export default function TabsLayout() {
  const colors = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
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
