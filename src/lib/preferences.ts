import type { SQLiteDatabase } from 'expo-sqlite';

import { setColorSchemeOverride } from '@/hooks/use-color-scheme';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme';

export async function getThemePref(db: SQLiteDatabase): Promise<ThemePref> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', THEME_KEY);
  return row?.value === 'light' || row?.value === 'dark' ? row.value : 'system';
}

/** Overrides the app's color scheme; every useColorScheme() consumer follows it. */
export function applyThemePref(pref: ThemePref) {
  setColorSchemeOverride(pref === 'system' ? null : pref);
}

export async function setThemePref(db: SQLiteDatabase, pref: ThemePref) {
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', THEME_KEY, pref);
  applyThemePref(pref);
}
