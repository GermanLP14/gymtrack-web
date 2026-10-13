import { useSyncExternalStore } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

export type ColorScheme = 'light' | 'dark';

// react-native-web has no Appearance.setColorScheme, so the theme chosen in
// Ajustes lives here and wins over the browser's preference.
let override: ColorScheme | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Forces a color scheme, or follows the browser when `null`. */
export function setColorSchemeOverride(next: ColorScheme | null) {
  override = next;
  listeners.forEach((l) => l());
}

export function useColorScheme(): ColorScheme {
  const system = useSystemColorScheme();
  const forced = useSyncExternalStore(subscribe, () => override);
  return forced ?? (system === 'dark' ? 'dark' : 'light');
}
