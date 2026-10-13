import type { SQLiteDatabase } from 'expo-sqlite';

import { ROUTINE_COLOR_COUNT } from '@/constants/theme';
import { SEED_EXERCISES, SEED_ROUTINES } from './seed-data';
import { seedRoutineUid } from './sync-schema';

const SEED_KEY = 'seed_default_routines_v1';

/**
 * Inserts the default routines once. The flag lives in `settings`, so a
 * default routine the user deletes does not come back on the next launch.
 */
export async function seedDefaultRoutines(db: SQLiteDatabase) {
  const done = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', SEED_KEY);
  if (done) return;

  await db.withTransactionAsync(async () => {
    const now = Date.now();
    for (const e of SEED_EXERCISES) {
      await db.runAsync(
        `INSERT INTO exercises
           (id, name, name_es, gif_url, body_parts, target_muscles, secondary_muscles, equipments, instructions, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name_es = excluded.name_es`,
        e.id,
        e.name,
        e.nameEs,
        e.gifUrl,
        JSON.stringify(e.bodyParts),
        JSON.stringify(e.targetMuscles),
        JSON.stringify(e.secondaryMuscles),
        JSON.stringify(e.equipments),
        JSON.stringify(e.instructions),
        now,
      );
    }

    // Routines are listed newest first; stepping created_at back keeps the seed order.
    // Colors continue after any routines the user already has.
    const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM routines');
    for (const [i, r] of SEED_ROUTINES.entries()) {
      const color = ((existing?.n ?? 0) + i) % ROUTINE_COLOR_COUNT;
      const res = await db.runAsync(
        'INSERT INTO routines (uid, name, created_at, color) VALUES (?, ?, ?, ?)',
        seedRoutineUid(r.name),
        r.name,
        now - i,
        color,
      );
      for (const [position, ex] of r.exercises.entries()) {
        await db.runAsync(
          `INSERT INTO routine_exercises (routine_id, exercise_id, position, target_sets, rep_min, rep_max, rest_sec)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          res.lastInsertRowId,
          ex.id,
          position,
          ex.sets,
          ex.repMin,
          ex.repMax,
          ex.restSec,
        );
      }
    }

    // Untouched defaults are not uploaded, so they never overwrite the same
    // routine already edited on another device.
    await db.runAsync("UPDATE routines SET dirty = 0, updated_at = 0 WHERE uid LIKE 'seed:%'");

    await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', SEED_KEY, String(now));
  });
}
