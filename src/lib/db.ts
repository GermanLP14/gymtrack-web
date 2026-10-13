import type { SQLiteDatabase } from 'expo-sqlite';

import { seedDefaultRoutines } from './seed';
import { addSyncSchema } from './sync-schema';

export const DATABASE_NAME = 'gymtrack.db';
const DATABASE_VERSION = 5;

/** Runs pending schema migrations and seeds default data. Passed to `<SQLiteProvider onInit>`. */
export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrateSchema(db);
  await seedDefaultRoutines(db);
}

async function migrateSchema(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version >= DATABASE_VERSION) return;

  if (version === 0) {
    await db.execAsync(`
      -- Exercises downloaded from ExerciseDB, cached so the app works offline
      -- and stays under the public API's rate limit.
      CREATE TABLE exercises (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        gif_url TEXT,
        body_parts TEXT NOT NULL DEFAULT '[]',
        target_muscles TEXT NOT NULL DEFAULT '[]',
        secondary_muscles TEXT NOT NULL DEFAULT '[]',
        equipments TEXT NOT NULL DEFAULT '[]',
        instructions TEXT NOT NULL DEFAULT '[]',
        cached_at INTEGER NOT NULL
      );

      CREATE TABLE api_cache (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );

      CREATE TABLE routines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        notes TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE routine_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        exercise_id TEXT NOT NULL REFERENCES exercises(id),
        position INTEGER NOT NULL,
        target_sets INTEGER NOT NULL DEFAULT 3,
        rep_min INTEGER NOT NULL DEFAULT 8,
        rep_max INTEGER NOT NULL DEFAULT 12,
        increment_kg REAL NOT NULL DEFAULT 2.5,
        rest_sec INTEGER NOT NULL DEFAULT 90
      );
      CREATE INDEX idx_routine_exercises_routine ON routine_exercises(routine_id, position);

      CREATE TABLE workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        routine_id INTEGER REFERENCES routines(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        date TEXT NOT NULL,            -- local day, YYYY-MM-DD
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      );
      CREATE INDEX idx_workouts_date ON workouts(date);

      CREATE TABLE workout_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
        exercise_id TEXT NOT NULL REFERENCES exercises(id),
        exercise_order INTEGER NOT NULL,
        set_index INTEGER NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        rpe REAL,
        completed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_workout_sets_workout ON workout_sets(workout_id);
      CREATE INDEX idx_workout_sets_exercise ON workout_sets(exercise_id);

      CREATE TABLE daily_steps (
        date TEXT PRIMARY KEY NOT NULL,
        steps INTEGER NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
    version = 1;
  }

  if (version === 1) {
    // Spanish display name; ExerciseDB only provides English names.
    await db.execAsync('ALTER TABLE exercises ADD COLUMN name_es TEXT;');
    version = 2;
  }

  if (version === 2) {
    await db.execAsync(`
      -- Index into ROUTINE_COLORS; stored as a slot so each theme picks its own shade.
      ALTER TABLE routines ADD COLUMN color INTEGER;
      UPDATE routines SET color = (id - 1) % 8;

      ALTER TABLE workouts ADD COLUMN calories REAL;
      ALTER TABLE workouts ADD COLUMN ai_summary TEXT;

      CREATE TABLE weight_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,   -- one entry per local day, YYYY-MM-DD
        weight REAL NOT NULL,
        photo_uri TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    version = 3;
  }

  if (version === 3) {
    // The step counter was removed.
    await db.execAsync(`
      DROP TABLE IF EXISTS daily_steps;
      DELETE FROM settings WHERE key = 'stepGoal';
    `);
    version = 4;
  }

  if (version === 4) {
    await db.withTransactionAsync(() => addSyncSchema(db));
    version = 5;
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
