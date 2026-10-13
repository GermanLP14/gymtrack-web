import type { SQLiteDatabase } from 'expo-sqlite';

import { SEED_ROUTINES } from './seed-data';

/** Default routines share a fixed uid, so every device's copy is the same synced routine. */
export const seedRoutineUid = (name: string) => `seed:${name}`;

/** Current time in epoch milliseconds, as a SQL expression. */
const NOW = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

/**
 * Local bookkeeping for cloud sync (see sync.ts). Each synced row carries
 * `updated_at` and a `dirty` flag, and deletions leave a tombstone. Triggers
 * maintain all of it, so the queries in repo.ts and body.ts stay unaware of sync.
 */
export async function addSyncSchema(db: SQLiteDatabase) {
  await db.execAsync(`
    ALTER TABLE routines ADD COLUMN uid TEXT;
    ALTER TABLE routines ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE routines ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE workouts ADD COLUMN uid TEXT;
    ALTER TABLE workouts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE workouts ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE weight_logs ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE weight_logs ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE settings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE settings ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE sync_tombstones (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      PRIMARY KEY (kind, id)
    );

    -- Everything recorded before sync existed is uploaded on the first sync.
    UPDATE routines SET uid = lower(hex(randomblob(16))), updated_at = created_at, dirty = 1;
    UPDATE workouts SET uid = lower(hex(randomblob(16))), updated_at = COALESCE(finished_at, started_at), dirty = 1;
    UPDATE weight_logs SET updated_at = created_at, dirty = 1;
    UPDATE settings SET updated_at = ${NOW}, dirty = 1 WHERE key IN ('profile', 'targetWeight');
  `);

  for (const r of SEED_ROUTINES) {
    await db.runAsync(
      'UPDATE routines SET uid = ? WHERE id = (SELECT id FROM routines WHERE name = ? ORDER BY created_at LIMIT 1)',
      seedRoutineUid(r.name),
      r.name,
    );
  }

  await db.execAsync(`
    CREATE UNIQUE INDEX idx_routines_uid ON routines(uid);
    CREATE UNIQUE INDEX idx_workouts_uid ON workouts(uid);

    CREATE TRIGGER sync_routines_uid AFTER INSERT ON routines WHEN NEW.uid IS NULL BEGIN
      UPDATE routines SET uid = lower(hex(randomblob(16))) WHERE id = NEW.id;
    END;
    CREATE TRIGGER sync_routines_insert AFTER INSERT ON routines BEGIN
      UPDATE routines SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.id;
    END;
    CREATE TRIGGER sync_routines_update AFTER UPDATE OF name, notes, color ON routines BEGIN
      UPDATE routines SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.id;
    END;
    CREATE TRIGGER sync_routines_delete AFTER DELETE ON routines WHEN OLD.uid IS NOT NULL BEGIN
      INSERT OR REPLACE INTO sync_tombstones (kind, id, deleted_at) VALUES ('routine', OLD.uid, ${NOW});
    END;
    CREATE TRIGGER sync_routine_exercises_insert AFTER INSERT ON routine_exercises BEGIN
      UPDATE routines SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.routine_id;
    END;
    CREATE TRIGGER sync_routine_exercises_update AFTER UPDATE ON routine_exercises BEGIN
      UPDATE routines SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.routine_id;
    END;
    CREATE TRIGGER sync_routine_exercises_delete AFTER DELETE ON routine_exercises BEGIN
      UPDATE routines SET dirty = 1, updated_at = ${NOW} WHERE id = OLD.routine_id;
    END;

    CREATE TRIGGER sync_workouts_uid AFTER INSERT ON workouts WHEN NEW.uid IS NULL BEGIN
      UPDATE workouts SET uid = lower(hex(randomblob(16))) WHERE id = NEW.id;
    END;
    CREATE TRIGGER sync_workouts_insert AFTER INSERT ON workouts BEGIN
      UPDATE workouts SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.id;
    END;
    CREATE TRIGGER sync_workouts_update
    AFTER UPDATE OF routine_id, name, date, started_at, finished_at, calories, ai_summary ON workouts BEGIN
      UPDATE workouts SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.id;
    END;
    CREATE TRIGGER sync_workouts_delete AFTER DELETE ON workouts WHEN OLD.uid IS NOT NULL BEGIN
      INSERT OR REPLACE INTO sync_tombstones (kind, id, deleted_at) VALUES ('workout', OLD.uid, ${NOW});
    END;
    CREATE TRIGGER sync_workout_sets_insert AFTER INSERT ON workout_sets BEGIN
      UPDATE workouts SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.workout_id;
    END;
    CREATE TRIGGER sync_workout_sets_update AFTER UPDATE ON workout_sets BEGIN
      UPDATE workouts SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.workout_id;
    END;
    CREATE TRIGGER sync_workout_sets_delete AFTER DELETE ON workout_sets BEGIN
      UPDATE workouts SET dirty = 1, updated_at = ${NOW} WHERE id = OLD.workout_id;
    END;

    -- Progress photos stay on the device, so photo_uri changes are not synced.
    CREATE TRIGGER sync_weight_insert AFTER INSERT ON weight_logs BEGIN
      UPDATE weight_logs SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.id;
      DELETE FROM sync_tombstones WHERE kind = 'weight' AND id = NEW.date;
    END;
    CREATE TRIGGER sync_weight_update AFTER UPDATE OF date, weight ON weight_logs BEGIN
      UPDATE weight_logs SET dirty = 1, updated_at = ${NOW} WHERE id = NEW.id;
    END;
    CREATE TRIGGER sync_weight_delete AFTER DELETE ON weight_logs BEGIN
      INSERT OR REPLACE INTO sync_tombstones (kind, id, deleted_at) VALUES ('weight', OLD.date, ${NOW});
    END;

    CREATE TRIGGER sync_settings_insert AFTER INSERT ON settings WHEN NEW.key IN ('profile', 'targetWeight') BEGIN
      UPDATE settings SET dirty = 1, updated_at = ${NOW} WHERE key = NEW.key;
      DELETE FROM sync_tombstones WHERE kind = 'setting' AND id = NEW.key;
    END;
    CREATE TRIGGER sync_settings_update AFTER UPDATE OF value ON settings WHEN NEW.key IN ('profile', 'targetWeight') BEGIN
      UPDATE settings SET dirty = 1, updated_at = ${NOW} WHERE key = NEW.key;
    END;
    CREATE TRIGGER sync_settings_delete AFTER DELETE ON settings WHEN OLD.key IN ('profile', 'targetWeight') BEGIN
      INSERT OR REPLACE INTO sync_tombstones (kind, id, deleted_at) VALUES ('setting', OLD.key, ${NOW});
    END;
  `);
}
