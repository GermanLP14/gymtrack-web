import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { Suspense, useEffect, useState } from 'react';

import { DialogHost } from '@/components/dialog';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDocumentTheme } from '@/hooks/use-document-theme';
import { DATABASE_NAME, migrateDbIfNeeded } from '@/lib/db';
import { applyThemePref, getThemePref } from '@/lib/preferences';
import { startSync } from '@/lib/sync';

// A page opened directly (reload, pasted link) still gets the tabs underneath, so "back" has somewhere to go.
export const unstable_settings = { anchor: '(tabs)' };

/** Applies the saved theme, then shows the app. */
function App() {
  const db = useSQLiteContext();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Ask the browser not to evict this site's storage (the SQLite file) under disk pressure.
    void navigator.storage?.persist?.();
    getThemePref(db)
      .then(applyThemePref)
      .finally(() => setReady(true));
  }, [db]);

  useEffect(() => startSync(db), [db]);

  if (!ready) return null;
  return (
    <>
      <Stack
        screenOptions={{
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: 700, fontFamily: Fonts?.sans },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="routine/[id]" options={{ title: 'Rutina' }} />
        <Stack.Screen name="routine/edit" options={{ title: 'Editar rutina' }} />
        <Stack.Screen name="workout/[id]" options={{ title: 'Entrenamiento', gestureEnabled: false }} />
        <Stack.Screen name="history/[id]" options={{ title: 'Entrenamiento' }} />
        <Stack.Screen name="exercise/[id]" options={{ title: 'Ejercicio' }} />
        <Stack.Screen name="exercise-picker" options={{ title: 'Agregar ejercicio', presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ title: 'Ajustes' }} />
        <Stack.Screen name="onboarding" options={{ title: 'Bienvenido', presentation: 'modal' }} />
      </Stack>
      <DialogHost />
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useDocumentTheme();
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const colors = Colors[colorScheme];
  // Stack headers, modals and cards pick these up, so pages outside the tabs match the app palette.
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.tint,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
    },
  };
  return (
    <ThemeProvider value={navTheme}>
      <Suspense fallback={null}>
        {/* SQLiteProvider is memoized on its own props, so anything stateful lives in <App />. */}
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded} useSuspense>
          <App />
        </SQLiteProvider>
      </Suspense>
    </ThemeProvider>
  );
}
