import type { SQLiteDatabase } from 'expo-sqlite';

import { isValidProfile, type Profile } from './calories';

// ---------------------------------------------------------------- profile

const PROFILE_KEY = 'profile';
const TARGET_WEIGHT_KEY = 'targetWeight';

async function getSettingValue(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

async function setSettingValue(db: SQLiteDatabase, key: string, value: string | null) {
  if (value == null) await db.runAsync('DELETE FROM settings WHERE key = ?', key);
  else await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

export async function getProfile(db: SQLiteDatabase): Promise<Profile | null> {
  const raw = await getSettingValue(db, PROFILE_KEY);
  if (!raw) return null;
  const p = JSON.parse(raw) as Partial<Profile>;
  return isValidProfile(p) ? p : null;
}

export async function saveProfile(db: SQLiteDatabase, p: Profile) {
  await setSettingValue(db, PROFILE_KEY, JSON.stringify(p));
}

/** Profile with the most recent logged weight, which is what calorie estimates should use. */
export async function getEffectiveProfile(db: SQLiteDatabase): Promise<Profile | null> {
  const profile = await getProfile(db);
  if (!profile) return null;
  const latest = await db.getFirstAsync<{ weight: number }>('SELECT weight FROM weight_logs ORDER BY date DESC LIMIT 1');
  return latest ? { ...profile, weightKg: latest.weight } : profile;
}

// ---------------------------------------------------------------- weight log

export type WeightEntry = { id: number; date: string; weight: number; photoUri: string | null };

export async function listWeights(db: SQLiteDatabase): Promise<WeightEntry[]> {
  return db.getAllAsync<WeightEntry>('SELECT id, date, weight, photo_uri AS photoUri FROM weight_logs ORDER BY date DESC');
}

export async function getWeightForDay(db: SQLiteDatabase, date: string): Promise<WeightEntry | null> {
  return db.getFirstAsync<WeightEntry>('SELECT id, date, weight, photo_uri AS photoUri FROM weight_logs WHERE date = ?', date);
}

/**
 * Saves the weight for a day (one entry per day). A new photo replaces the
 * previous one for that day; `photoUri: undefined` keeps the existing photo.
 * Photos are data URLs stored in the row itself.
 */
export async function saveWeight(db: SQLiteDatabase, date: string, weight: number, photoUri?: string | null) {
  const existing = await getWeightForDay(db, date);
  if (existing) {
    await db.runAsync(
      'UPDATE weight_logs SET weight = ?, photo_uri = ? WHERE id = ?',
      weight,
      photoUri === undefined ? existing.photoUri : photoUri,
      existing.id,
    );
  } else {
    await db.runAsync(
      'INSERT INTO weight_logs (date, weight, photo_uri, created_at) VALUES (?, ?, ?, ?)',
      date,
      weight,
      photoUri ?? null,
      Date.now(),
    );
  }
}

export async function deleteWeight(db: SQLiteDatabase, entry: WeightEntry) {
  await db.runAsync('DELETE FROM weight_logs WHERE id = ?', entry.id);
}

export async function getTargetWeight(db: SQLiteDatabase): Promise<number | null> {
  const raw = await getSettingValue(db, TARGET_WEIGHT_KEY);
  return raw ? Number(raw) : null;
}

export async function setTargetWeight(db: SQLiteDatabase, weight: number | null) {
  await setSettingValue(db, TARGET_WEIGHT_KEY, weight == null ? null : String(weight));
}

// ---------------------------------------------------------------- progress photos

const PHOTO_MAX_SIDE = 1200;

/**
 * The browser has no app folder to copy the picked file into, so the photo is
 * downscaled and returned as a JPEG data URL that lives in the weight_logs row.
 */
export async function storeProgressPhoto(sourceUri: string): Promise<string> {
  const img = new window.Image();
  img.src = sourceUri;
  await img.decode();
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}
