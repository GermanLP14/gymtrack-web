import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { supabase } from './supabase';

/**
 * Two-way sync with Supabase. The app stays local-first: every screen reads
 * and writes SQLite, and this module mirrors it to one remote table,
 * `sync_items`, holding a JSON document per routine, workout, weight entry,
 * synced setting and referenced exercise.
 *
 * - Local changes are tracked by triggers (sync-schema.ts) as `dirty` rows and tombstones.
 * - Remote changes are read in order of `seq`, a counter the server bumps on every write.
 * - Conflicts resolve per document: the most recent `updated_at` wins.
 *
 * Workouts are uploaded once finished. Progress photos stay on the device.
 */

type Kind = 'exercise' | 'routine' | 'workout' | 'weight' | 'setting';

type Item = { kind: Kind; id: string; data: Record<string, any> | null; updated_at: number; deleted: boolean };

/** A routine needs its exercises, and a workout its routine, to already be in place. */
const APPLY_ORDER: Kind[] = ['exercise', 'routine', 'workout', 'weight', 'setting'];
const SYNCED_SETTINGS = ['profile', 'targetWeight'];

const PAGE_SIZE = 500;
const PUSH_CHUNK = 100;
const LOCAL_CHECK_MS = 5_000;
const PULL_EVERY_MS = 30_000;

type LocalState = { updated_at: number; dirty: number } | null;

/** True when the remote version must not replace the local row. */
function keepLocal(local: LocalState, remote: Item): boolean {
  if (!local) return false;
  if (local.dirty) return local.updated_at > remote.updated_at;
  return !remote.deleted && local.updated_at === remote.updated_at;
}

// ---------------------------------------------------------------- pull

async function pull(db: SQLiteDatabase, userId: string): Promise<number> {
  const cursorKey = `syncCursor:${userId}`;
  const stored = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', cursorKey);
  let cursor = Number(stored?.value ?? 0);

  const items: Item[] = [];
  for (;;) {
    const { data, error } = await supabase!
      .from('sync_items')
      .select('kind, id, data, updated_at, deleted, seq')
      .gt('seq', cursor)
      .order('seq')
      .limit(PAGE_SIZE);
    if (error) throw new Error(error.message);
    items.push(...(data as Item[]));
    if (data.length > 0) cursor = data[data.length - 1].seq;
    if (data.length < PAGE_SIZE) break;
  }
  if (items.length === 0) return 0;

  items.sort((a, b) => APPLY_ORDER.indexOf(a.kind) - APPLY_ORDER.indexOf(b.kind));
  let applied = 0;
  await db.withTransactionAsync(async () => {
    for (const item of items) if (await APPLY[item.kind]?.(db, item)) applied++;
    await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', cursorKey, String(cursor));
  });
  return applied;
}

/**
 * Each applier writes a remote document into SQLite and returns whether it
 * changed anything. Writing fires the tracking triggers, so every applier ends
 * by resetting `dirty` (or dropping the tombstone) for the row it touched.
 */
const APPLY: Record<Kind, (db: SQLiteDatabase, item: Item) => Promise<boolean>> = {
  async exercise(db, { id, data }) {
    if (!data) return false;
    const res = await db.runAsync(
      `INSERT OR IGNORE INTO exercises
         (id, name, name_es, gif_url, body_parts, target_muscles, secondary_muscles, equipments, instructions, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.name_es ?? null,
      data.gif_url ?? null,
      data.body_parts,
      data.target_muscles,
      data.secondary_muscles,
      data.equipments,
      data.instructions,
      Date.now(),
    );
    return res.changes > 0;
  },

  async routine(db, item) {
    const local = await db.getFirstAsync<{ id: number; updated_at: number; dirty: number }>(
      'SELECT id, updated_at, dirty FROM routines WHERE uid = ?',
      item.id,
    );
    if (keepLocal(local, item)) return false;
    if (item.deleted || !item.data) {
      if (!local) return false;
      await db.runAsync('DELETE FROM routines WHERE id = ?', local.id);
      await db.runAsync("DELETE FROM sync_tombstones WHERE kind = 'routine' AND id = ?", item.id);
      return true;
    }

    const d = item.data;
    let id = local?.id;
    if (id == null) {
      const res = await db.runAsync(
        'INSERT INTO routines (uid, name, notes, color, created_at) VALUES (?, ?, ?, ?, ?)',
        item.id,
        d.name,
        d.notes ?? null,
        d.color ?? null,
        d.created_at,
      );
      id = res.lastInsertRowId;
    } else {
      await db.runAsync('UPDATE routines SET name = ?, notes = ?, color = ? WHERE id = ?', d.name, d.notes ?? null, d.color ?? null, id);
      await db.runAsync('DELETE FROM routine_exercises WHERE routine_id = ?', id);
    }
    for (const e of d.exercises ?? []) {
      if (!(await exerciseExists(db, e.exercise_id))) continue;
      await db.runAsync(
        `INSERT INTO routine_exercises
           (routine_id, exercise_id, position, target_sets, rep_min, rep_max, increment_kg, rest_sec)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        e.exercise_id,
        e.position,
        e.target_sets,
        e.rep_min,
        e.rep_max,
        e.increment_kg,
        e.rest_sec,
      );
    }
    await db.runAsync('UPDATE routines SET dirty = 0, updated_at = ? WHERE id = ?', item.updated_at, id);
    return true;
  },

  async workout(db, item) {
    const local = await db.getFirstAsync<{ id: number; updated_at: number; dirty: number }>(
      'SELECT id, updated_at, dirty FROM workouts WHERE uid = ?',
      item.id,
    );
    if (keepLocal(local, item)) return false;
    if (item.deleted || !item.data) {
      if (!local) return false;
      await db.runAsync('DELETE FROM workouts WHERE id = ?', local.id);
      await db.runAsync("DELETE FROM sync_tombstones WHERE kind = 'workout' AND id = ?", item.id);
      return true;
    }

    const d = item.data;
    const routine = d.routine_uid
      ? await db.getFirstAsync<{ id: number }>('SELECT id FROM routines WHERE uid = ?', d.routine_uid)
      : null;
    const fields = [routine?.id ?? null, d.name, d.date, d.started_at, d.finished_at, d.calories ?? null, d.ai_summary ?? null];
    let id = local?.id;
    if (id == null) {
      const res = await db.runAsync(
        `INSERT INTO workouts (routine_id, name, date, started_at, finished_at, calories, ai_summary, uid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ...fields,
        item.id,
      );
      id = res.lastInsertRowId;
    } else {
      await db.runAsync(
        `UPDATE workouts
         SET routine_id = ?, name = ?, date = ?, started_at = ?, finished_at = ?, calories = ?, ai_summary = ?
         WHERE id = ?`,
        ...fields,
        id,
      );
      await db.runAsync('DELETE FROM workout_sets WHERE workout_id = ?', id);
    }
    for (const s of d.sets ?? []) {
      if (!(await exerciseExists(db, s.exercise_id))) continue;
      await db.runAsync(
        `INSERT INTO workout_sets (workout_id, exercise_id, exercise_order, set_index, weight, reps, rpe, completed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        s.exercise_id,
        s.exercise_order,
        s.set_index,
        s.weight,
        s.reps,
        s.rpe ?? null,
        s.completed ? 1 : 0,
      );
    }
    await db.runAsync('UPDATE workouts SET dirty = 0, updated_at = ? WHERE id = ?', item.updated_at, id);
    return true;
  },

  async weight(db, item) {
    const local = await db.getFirstAsync<{ id: number; updated_at: number; dirty: number }>(
      'SELECT id, updated_at, dirty FROM weight_logs WHERE date = ?',
      item.id,
    );
    if (keepLocal(local, item)) return false;
    if (item.deleted || !item.data) {
      if (!local) return false;
      await db.runAsync('DELETE FROM weight_logs WHERE id = ?', local.id);
      await db.runAsync("DELETE FROM sync_tombstones WHERE kind = 'weight' AND id = ?", item.id);
      return true;
    }
    if (local) await db.runAsync('UPDATE weight_logs SET weight = ? WHERE id = ?', item.data.weight, local.id);
    else {
      await db.runAsync(
        'INSERT INTO weight_logs (date, weight, created_at) VALUES (?, ?, ?)',
        item.id,
        item.data.weight,
        item.data.created_at ?? item.updated_at,
      );
    }
    await db.runAsync('UPDATE weight_logs SET dirty = 0, updated_at = ? WHERE date = ?', item.updated_at, item.id);
    return true;
  },

  async setting(db, item) {
    if (!SYNCED_SETTINGS.includes(item.id)) return false;
    const local = await db.getFirstAsync<{ updated_at: number; dirty: number }>(
      'SELECT updated_at, dirty FROM settings WHERE key = ?',
      item.id,
    );
    if (keepLocal(local, item)) return false;
    if (item.deleted || !item.data) {
      if (!local) return false;
      await db.runAsync('DELETE FROM settings WHERE key = ?', item.id);
      await db.runAsync("DELETE FROM sync_tombstones WHERE kind = 'setting' AND id = ?", item.id);
      return true;
    }
    await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', item.id, item.data.value);
    await db.runAsync('UPDATE settings SET dirty = 0, updated_at = ? WHERE key = ?', item.updated_at, item.id);
    return true;
  },
};

async function exerciseExists(db: SQLiteDatabase, id: string): Promise<boolean> {
  return (await db.getFirstAsync('SELECT 1 FROM exercises WHERE id = ?', id)) != null;
}

// ---------------------------------------------------------------- push

/** A change waiting to be uploaded, and how to mark it as uploaded afterwards. */
type Pending = { item: Item; clearSql: string; clearArgs: (string | number)[] };

async function collectPending(db: SQLiteDatabase): Promise<{ pending: Pending[]; exerciseIds: Set<string> }> {
  const pending: Pending[] = [];
  const exerciseIds = new Set<string>();

  const tombstones = await db.getAllAsync<{ kind: Kind; id: string; deleted_at: number }>('SELECT * FROM sync_tombstones');
  for (const t of tombstones) {
    pending.push({
      item: { kind: t.kind, id: t.id, data: null, updated_at: t.deleted_at, deleted: true },
      clearSql: 'DELETE FROM sync_tombstones WHERE kind = ? AND id = ? AND deleted_at = ?',
      clearArgs: [t.kind, t.id, t.deleted_at],
    });
  }

  const routines = await db.getAllAsync<Record<string, any>>(
    'SELECT id, uid, name, notes, color, created_at, updated_at FROM routines WHERE dirty = 1 AND uid IS NOT NULL',
  );
  for (const r of routines) {
    const exercises = await db.getAllAsync<Record<string, any>>(
      `SELECT exercise_id, position, target_sets, rep_min, rep_max, increment_kg, rest_sec
       FROM routine_exercises WHERE routine_id = ? ORDER BY position`,
      r.id,
    );
    exercises.forEach((e) => exerciseIds.add(e.exercise_id));
    pending.push({
      item: {
        kind: 'routine',
        id: r.uid,
        data: { name: r.name, notes: r.notes, color: r.color, created_at: r.created_at, exercises },
        updated_at: r.updated_at,
        deleted: false,
      },
      clearSql: 'UPDATE routines SET dirty = 0 WHERE uid = ? AND updated_at = ?',
      clearArgs: [r.uid, r.updated_at],
    });
  }

  const workouts = await db.getAllAsync<Record<string, any>>(
    `SELECT w.id, w.uid, w.name, w.date, w.started_at, w.finished_at, w.calories, w.ai_summary, w.updated_at,
            r.uid AS routine_uid
     FROM workouts w LEFT JOIN routines r ON r.id = w.routine_id
     WHERE w.dirty = 1 AND w.uid IS NOT NULL AND w.finished_at IS NOT NULL`,
  );
  for (const w of workouts) {
    const sets = await db.getAllAsync<Record<string, any>>(
      `SELECT exercise_id, exercise_order, set_index, weight, reps, rpe, completed
       FROM workout_sets WHERE workout_id = ? ORDER BY exercise_order, set_index`,
      w.id,
    );
    sets.forEach((s) => exerciseIds.add(s.exercise_id));
    const { id, uid, updated_at, ...data } = w;
    pending.push({
      item: { kind: 'workout', id: uid, data: { ...data, sets }, updated_at, deleted: false },
      clearSql: 'UPDATE workouts SET dirty = 0 WHERE uid = ? AND updated_at = ?',
      clearArgs: [uid, updated_at],
    });
  }

  const weights = await db.getAllAsync<{ date: string; weight: number; created_at: number; updated_at: number }>(
    'SELECT date, weight, created_at, updated_at FROM weight_logs WHERE dirty = 1',
  );
  for (const w of weights) {
    pending.push({
      item: { kind: 'weight', id: w.date, data: { weight: w.weight, created_at: w.created_at }, updated_at: w.updated_at, deleted: false },
      clearSql: 'UPDATE weight_logs SET dirty = 0 WHERE date = ? AND updated_at = ?',
      clearArgs: [w.date, w.updated_at],
    });
  }

  const settings = await db.getAllAsync<{ key: string; value: string; updated_at: number }>(
    'SELECT key, value, updated_at FROM settings WHERE dirty = 1',
  );
  for (const s of settings) {
    pending.push({
      item: { kind: 'setting', id: s.key, data: { value: s.value }, updated_at: s.updated_at, deleted: false },
      clearSql: 'UPDATE settings SET dirty = 0 WHERE key = ? AND updated_at = ?',
      clearArgs: [s.key, s.updated_at],
    });
  }

  return { pending, exerciseIds };
}

async function push(db: SQLiteDatabase, userId: string): Promise<number> {
  const { pending, exerciseIds } = await collectPending(db);
  if (pending.length === 0) return 0;

  // Exercises never change once downloaded, so existing remote copies are left alone.
  if (exerciseIds.size > 0) {
    const ids = [...exerciseIds];
    const rows = await db.getAllAsync<Record<string, any>>(
      `SELECT id, name, name_es, gif_url, body_parts, target_muscles, secondary_muscles, equipments, instructions
       FROM exercises WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ...ids,
    );
    const items = rows.map(({ id, ...data }) => ({ user_id: userId, kind: 'exercise', id, data, updated_at: 0, deleted: false }));
    for (let i = 0; i < items.length; i += PUSH_CHUNK) {
      const { error } = await supabase!
        .from('sync_items')
        .upsert(items.slice(i, i + PUSH_CHUNK), { onConflict: 'user_id,kind,id', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
  }

  for (let i = 0; i < pending.length; i += PUSH_CHUNK) {
    const chunk = pending.slice(i, i + PUSH_CHUNK);
    const { error } = await supabase!
      .from('sync_items')
      .upsert(chunk.map((p) => ({ user_id: userId, ...p.item })), { onConflict: 'user_id,kind,id' });
    if (error) throw new Error(error.message);
    // The updated_at guard keeps a row dirty if it was edited again during the upload.
    for (const p of chunk) await db.runAsync(p.clearSql, ...p.clearArgs);
  }
  return pending.length;
}

async function hasLocalChanges(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT EXISTS (SELECT 1 FROM sync_tombstones)
         OR EXISTS (SELECT 1 FROM routines WHERE dirty = 1)
         OR EXISTS (SELECT 1 FROM workouts WHERE dirty = 1 AND finished_at IS NOT NULL)
         OR EXISTS (SELECT 1 FROM weight_logs WHERE dirty = 1)
         OR EXISTS (SELECT 1 FROM settings WHERE dirty = 1) AS n`,
  );
  return !!row?.n;
}

/** Signing in with another account uploads this device's data to it too. */
async function claimForUser(db: SQLiteDatabase, userId: string) {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'syncUser'");
  if (row?.value === userId) return;
  if (row) {
    await db.execAsync(`
      UPDATE routines SET dirty = 1 WHERE updated_at > 0;
      UPDATE workouts SET dirty = 1;
      UPDATE weight_logs SET dirty = 1;
      UPDATE settings SET dirty = 1 WHERE key IN ('profile', 'targetWeight');
    `);
  }
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('syncUser', ?)", userId);
}

// ---------------------------------------------------------------- status

export type SyncStatus = {
  /** Signed-in account, or null when signed out. */
  email: string | null;
  syncing: boolean;
  lastSyncAt: number | null;
  error: string | null;
};

let status: SyncStatus = { email: null, syncing: false, lastSyncAt: null, error: null };
const statusListeners = new Set<() => void>();
const remoteChangeListeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => void statusListeners.delete(l);
    },
    () => status,
  );
}

/** Calls `listener` after a sync brought in changes made on another device. */
export function onRemoteChange(listener: () => void): () => void {
  remoteChangeListeners.add(listener);
  return () => void remoteChangeListeners.delete(listener);
}

// ---------------------------------------------------------------- runner

let activeDb: SQLiteDatabase | null = null;
let running = false;
let lastPullAt = 0;

/** Pulls, then pushes. `force` skips the "nothing to do yet" check of the background timer. */
export async function syncNow(force = true) {
  const db = activeDb;
  if (!supabase || !db || running) return;
  running = true;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return;
    if (!force && Date.now() - lastPullAt < PULL_EVERY_MS && !(await hasLocalChanges(db))) return;

    setStatus({ syncing: true });
    await claimForUser(db, user.id);
    const applied = await pull(db, user.id);
    lastPullAt = Date.now();
    await push(db, user.id);
    setStatus({ syncing: false, lastSyncAt: Date.now(), error: null });
    if (applied > 0) remoteChangeListeners.forEach((l) => l());
  } catch (e) {
    setStatus({ syncing: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
}

/** Keeps the database in sync while the app is open. Returns a cleanup function. */
export function startSync(db: SQLiteDatabase): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  activeDb = db;

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    setStatus({ email: session?.user.email ?? null, ...(session ? {} : { lastSyncAt: null, error: null }) });
    // Supabase calls must not run inside this callback, so the sync is deferred.
    if (session) setTimeout(() => void syncNow(), 0);
  });
  const timer = setInterval(() => void syncNow(false), LOCAL_CHECK_MS);
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void client.auth.startAutoRefresh();
      void syncNow();
    } else {
      void client.auth.stopAutoRefresh();
    }
  });

  return () => {
    data.subscription.unsubscribe();
    clearInterval(timer);
    appState.remove();
    activeDb = null;
  };
}
