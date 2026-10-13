import type { SQLiteDatabase } from 'expo-sqlite';

import { getEffectiveProfile } from './body';
import { workoutCalories } from './calories';
import { addDays, fromDayKey, startOfWeek, toDayKey } from './dates';
import { getExercise } from './exercisedb';
import { DEFAULT_TARGET, recommend, type ProgressionTarget, type Recommendation } from './progression';
import type { ExerciseSession } from './stats';

// ---------------------------------------------------------------- routines

export type RoutineSummary = {
  id: number;
  name: string;
  notes: string | null;
  color: number | null;
  exerciseCount: number;
  lastDone: string | null;
};

export type RoutineExercise = ProgressionTarget & {
  id: number;
  exerciseId: string;
  name: string;
  gifUrl: string | null;
  position: number;
  restSec: number;
};

export type Routine = { id: number; name: string; notes: string | null; color: number | null; exercises: RoutineExercise[] };

export async function listRoutines(db: SQLiteDatabase): Promise<RoutineSummary[]> {
  return db.getAllAsync<RoutineSummary>(`
    SELECT r.id, r.name, r.notes, r.color,
      (SELECT COUNT(*) FROM routine_exercises re WHERE re.routine_id = r.id) AS exerciseCount,
      (SELECT MAX(w.date) FROM workouts w WHERE w.routine_id = r.id AND w.finished_at IS NOT NULL) AS lastDone
    FROM routines r
    ORDER BY r.created_at DESC, r.id DESC`);
}

export async function getRoutine(db: SQLiteDatabase, id: number): Promise<Routine | null> {
  const r = await db.getFirstAsync<Omit<Routine, 'exercises'>>('SELECT id, name, notes, color FROM routines WHERE id = ?', id);
  if (!r) return null;
  const exercises = await db.getAllAsync<RoutineExercise>(
    `SELECT re.id, re.exercise_id AS exerciseId, COALESCE(e.name_es, e.name) AS name, e.gif_url AS gifUrl, re.position,
            re.target_sets AS targetSets, re.rep_min AS repMin, re.rep_max AS repMax,
            re.increment_kg AS incrementKg, re.rest_sec AS restSec
     FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id
     WHERE re.routine_id = ? ORDER BY re.position`,
    id,
  );
  return { ...r, exercises };
}

export async function deleteRoutine(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM routines WHERE id = ?', id);
}

export type RoutineInput = {
  routineId: number | null;
  name: string;
  color: number;
  exercises: (ProgressionTarget & { exerciseId: string; restSec: number })[];
};

/**
 * Creates or fully replaces a routine in one transaction. Workouts only
 * reference the routine itself, so rewriting its exercise rows is safe.
 */
export async function saveRoutine(db: SQLiteDatabase, input: RoutineInput): Promise<number> {
  let id = input.routineId;
  await db.withTransactionAsync(async () => {
    if (id == null) {
      const res = await db.runAsync(
        'INSERT INTO routines (name, created_at, color) VALUES (?, ?, ?)',
        input.name,
        Date.now(),
        input.color,
      );
      id = res.lastInsertRowId;
    } else {
      await db.runAsync('UPDATE routines SET name = ?, color = ? WHERE id = ?', input.name, input.color, id);
      await db.runAsync('DELETE FROM routine_exercises WHERE routine_id = ?', id);
    }
    for (const [position, ex] of input.exercises.entries()) {
      await db.runAsync(
        `INSERT INTO routine_exercises
           (routine_id, exercise_id, position, target_sets, rep_min, rep_max, increment_kg, rest_sec)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        ex.exerciseId,
        position,
        ex.targetSets,
        ex.repMin,
        ex.repMax,
        ex.incrementKg,
        ex.restSec,
      );
    }
  });
  return id!;
}

// ---------------------------------------------------------------- history & coach

/**
 * Completed sessions of one exercise from finished workouts, oldest first.
 * `routineId` limits them to one routine: the same exercise in another routine
 * is trained in a different context (order, fatigue), so its loads differ.
 */
export async function getExerciseSessions(
  db: SQLiteDatabase,
  exerciseId: string,
  opts: { sinceDay?: string; routineId?: number } = {},
): Promise<ExerciseSession[]> {
  const routineId = opts.routineId ?? null;
  const rows = await db.getAllAsync<{ workoutId: number; date: string; weight: number; reps: number; rpe: number | null }>(
    `SELECT w.id AS workoutId, w.date, s.weight, s.reps, s.rpe
     FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
     WHERE s.exercise_id = ? AND s.completed = 1 AND w.finished_at IS NOT NULL AND w.date >= ?
       AND (? IS NULL OR w.routine_id = ?)
     ORDER BY w.started_at, s.set_index`,
    exerciseId,
    opts.sinceDay ?? '0000-00-00',
    routineId,
    routineId,
  );
  const sessions: ExerciseSession[] = [];
  for (const r of rows) {
    let cur = sessions[sessions.length - 1];
    if (!cur || cur.workoutId !== r.workoutId) {
      cur = { workoutId: r.workoutId, date: r.date, sets: [] };
      sessions.push(cur);
    }
    cur.sets.push({ weight: r.weight, reps: r.reps, rpe: r.rpe });
  }
  return sessions;
}

/** Targets from the most recently created routine that includes the exercise. */
export async function getTargetFor(db: SQLiteDatabase, exerciseId: string): Promise<ProgressionTarget> {
  const row = await db.getFirstAsync<ProgressionTarget>(
    `SELECT re.target_sets AS targetSets, re.rep_min AS repMin, re.rep_max AS repMax, re.increment_kg AS incrementKg
     FROM routine_exercises re JOIN routines r ON r.id = re.routine_id
     WHERE re.exercise_id = ? ORDER BY r.created_at DESC LIMIT 1`,
    exerciseId,
  );
  return row ?? DEFAULT_TARGET;
}

/**
 * Coach recommendation for an exercise. Inside a routine it uses that routine's
 * history; the first time the exercise appears there it falls back to all of
 * its history so the starting weight is not zero.
 */
export async function getRecommendation(
  db: SQLiteDatabase,
  exerciseId: string,
  target?: ProgressionTarget,
  routineId?: number | null,
): Promise<Recommendation> {
  const [scoped, t] = await Promise.all([
    routineId != null ? getExerciseSessions(db, exerciseId, { routineId }) : Promise.resolve([]),
    target ? Promise.resolve(target) : getTargetFor(db, exerciseId),
  ]);
  const sessions = scoped.length > 0 ? scoped : await getExerciseSessions(db, exerciseId);
  return recommend(sessions, t);
}

export type TrackedExercise = { id: string; name: string; sessions: number; lastDate: string };

export async function listTrackedExercises(db: SQLiteDatabase): Promise<TrackedExercise[]> {
  return db.getAllAsync<TrackedExercise>(`
    SELECT e.id, COALESCE(e.name_es, e.name) AS name, COUNT(DISTINCT w.id) AS sessions, MAX(w.date) AS lastDate
    FROM workout_sets s
    JOIN workouts w ON w.id = s.workout_id
    JOIN exercises e ON e.id = s.exercise_id
    WHERE s.completed = 1 AND w.finished_at IS NOT NULL
    GROUP BY e.id ORDER BY name COLLATE NOCASE`);
}

export type CoachItem = { exerciseId: string; name: string; recommendation: Recommendation };

/** Recommendations for exercises trained recently, most actionable first. */
export async function getCoachOverview(db: SQLiteDatabase, days = 21): Promise<CoachItem[]> {
  const since = toDayKey(addDays(new Date(), -days));
  const tracked = (await listTrackedExercises(db)).filter((t) => t.lastDate >= since);
  const items = await Promise.all(
    tracked.map(async (t) => ({
      exerciseId: t.id,
      name: t.name,
      recommendation: await getRecommendation(db, t.id),
    })),
  );
  const priority: Record<string, number> = { increase: 0, decrease: 1, deload: 2, hold: 3, start: 4 };
  return items.sort((a, b) => priority[a.recommendation.action] - priority[b.recommendation.action]);
}

// ---------------------------------------------------------------- workouts

export type WorkoutSet = {
  id: number;
  exerciseId: string;
  exerciseOrder: number;
  setIndex: number;
  weight: number;
  reps: number;
  rpe: number | null;
  completed: boolean;
};

export type WorkoutExercise = { exerciseId: string; name: string; gifUrl: string | null; order: number; sets: WorkoutSet[] };

export type Workout = {
  id: number;
  routineId: number | null;
  /** Routine color slot; null for free workouts or deleted routines. */
  color: number | null;
  calories: number | null;
  aiSummary: string | null;
  name: string;
  date: string;
  startedAt: number;
  finishedAt: number | null;
  exercises: WorkoutExercise[];
};

export async function getActiveWorkoutId(db: SQLiteDatabase): Promise<number | null> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM workouts WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1',
  );
  return row?.id ?? null;
}

async function insertSetsFromRecommendation(
  db: SQLiteDatabase,
  workoutId: number,
  exerciseId: string,
  order: number,
  target?: ProgressionTarget,
  routineId?: number | null,
) {
  const rec = await getRecommendation(db, exerciseId, target, routineId);
  for (let i = 0; i < rec.sets; i++) {
    await db.runAsync(
      `INSERT INTO workout_sets (workout_id, exercise_id, exercise_order, set_index, weight, reps)
       VALUES (?, ?, ?, ?, ?, ?)`,
      workoutId,
      exerciseId,
      order,
      i,
      rec.weight ?? 0,
      rec.reps,
    );
  }
}

/** Starts a workout, pre-filling every set with the coach's suggested weight and reps. */
export async function startWorkout(db: SQLiteDatabase, routineId: number | null): Promise<number> {
  const routine = routineId != null ? await getRoutine(db, routineId) : null;
  const now = new Date();
  const res = await db.runAsync(
    'INSERT INTO workouts (routine_id, name, date, started_at) VALUES (?, ?, ?, ?)',
    routine?.id ?? null,
    routine?.name ?? 'Entrenamiento libre',
    toDayKey(now),
    now.getTime(),
  );
  const workoutId = res.lastInsertRowId;
  if (routine) {
    for (const [order, ex] of routine.exercises.entries()) {
      await insertSetsFromRecommendation(db, workoutId, ex.exerciseId, order, ex, routine.id);
    }
  }
  return workoutId;
}

export async function getWorkout(db: SQLiteDatabase, id: number): Promise<Workout | null> {
  const w = await db.getFirstAsync<Omit<Workout, 'exercises'>>(
    `SELECT w.id, w.routine_id AS routineId, r.color, w.calories, w.ai_summary AS aiSummary, w.name, w.date,
            w.started_at AS startedAt, w.finished_at AS finishedAt
     FROM workouts w LEFT JOIN routines r ON r.id = w.routine_id WHERE w.id = ?`,
    id,
  );
  if (!w) return null;
  const rows = await db.getAllAsync<Omit<WorkoutSet, 'completed'> & { name: string; gifUrl: string | null; completed: number }>(
    `SELECT s.id, s.exercise_id AS exerciseId, s.exercise_order AS exerciseOrder, s.set_index AS setIndex,
            s.weight, s.reps, s.rpe, s.completed, COALESCE(e.name_es, e.name) AS name, e.gif_url AS gifUrl
     FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = ? ORDER BY s.exercise_order, s.set_index`,
    id,
  );
  const exercises: WorkoutExercise[] = [];
  for (const r of rows) {
    let ex = exercises[exercises.length - 1];
    if (!ex || ex.order !== r.exerciseOrder) {
      ex = { exerciseId: r.exerciseId, name: r.name, gifUrl: r.gifUrl, order: r.exerciseOrder, sets: [] };
      exercises.push(ex);
    }
    const { name: _n, gifUrl: _g, ...set } = r;
    ex.sets.push({ ...set, completed: r.completed === 1 });
  }
  return { ...w, exercises };
}

export async function addWorkoutExercise(db: SQLiteDatabase, workoutId: number, exerciseId: string) {
  await getExercise(db, exerciseId);
  const row = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(exercise_order), -1) + 1 AS next FROM workout_sets WHERE workout_id = ?',
    workoutId,
  );
  const w = await db.getFirstAsync<{ routine_id: number | null }>('SELECT routine_id FROM workouts WHERE id = ?', workoutId);
  await insertSetsFromRecommendation(db, workoutId, exerciseId, row?.next ?? 0, undefined, w?.routine_id);
}

/** Adds a set to an exercise, copying the values of its last set. */
export async function addSet(db: SQLiteDatabase, workoutId: number, exerciseOrder: number) {
  const last = await db.getFirstAsync<{ exercise_id: string; set_index: number; weight: number; reps: number }>(
    `SELECT exercise_id, set_index, weight, reps FROM workout_sets
     WHERE workout_id = ? AND exercise_order = ? ORDER BY set_index DESC LIMIT 1`,
    workoutId,
    exerciseOrder,
  );
  if (!last) return;
  await db.runAsync(
    `INSERT INTO workout_sets (workout_id, exercise_id, exercise_order, set_index, weight, reps)
     VALUES (?, ?, ?, ?, ?, ?)`,
    workoutId,
    last.exercise_id,
    exerciseOrder,
    last.set_index + 1,
    last.weight,
    last.reps,
  );
}

export async function updateSet(
  db: SQLiteDatabase,
  id: number,
  s: { weight: number; reps: number; rpe: number | null; completed: boolean },
) {
  await db.runAsync(
    'UPDATE workout_sets SET weight = ?, reps = ?, rpe = ?, completed = ? WHERE id = ?',
    s.weight,
    s.reps,
    s.rpe,
    s.completed ? 1 : 0,
    id,
  );
}

export async function deleteSet(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM workout_sets WHERE id = ?', id);
}

export async function removeWorkoutExercise(db: SQLiteDatabase, workoutId: number, exerciseOrder: number) {
  await db.runAsync('DELETE FROM workout_sets WHERE workout_id = ? AND exercise_order = ?', workoutId, exerciseOrder);
}

/**
 * Finishes the workout, discarding sets that were never marked completed, and
 * stores its estimated calories. Returns false (and deletes the workout) when
 * nothing was completed.
 */
export async function finishWorkout(db: SQLiteDatabase, id: number): Promise<boolean> {
  await db.runAsync('DELETE FROM workout_sets WHERE workout_id = ? AND completed = 0', id);
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM workout_sets WHERE workout_id = ?', id);
  if (!row || row.n === 0) {
    await deleteWorkout(db, id);
    return false;
  }
  const finishedAt = Date.now();
  const w = await db.getFirstAsync<{ started_at: number }>('SELECT started_at FROM workouts WHERE id = ?', id);
  const profile = await getEffectiveProfile(db);
  const calories = profile && w ? Math.round(workoutCalories(profile, finishedAt - w.started_at)) : null;
  await db.runAsync('UPDATE workouts SET finished_at = ?, calories = ? WHERE id = ?', finishedAt, calories, id);
  return true;
}

/** The previous finished workout of the same routine, for "last time" comparisons. */
export async function getPreviousRoutineWorkout(db: SQLiteDatabase, workout: Workout): Promise<Workout | null> {
  if (workout.routineId == null) return null;
  const row = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM workouts
     WHERE routine_id = ? AND finished_at IS NOT NULL AND id != ? AND started_at < ?
     ORDER BY started_at DESC LIMIT 1`,
    workout.routineId,
    workout.id,
    workout.startedAt,
  );
  return row ? getWorkout(db, row.id) : null;
}

export async function setWorkoutSummary(db: SQLiteDatabase, id: number, summary: string | null) {
  await db.runAsync('UPDATE workouts SET ai_summary = ? WHERE id = ?', summary, id);
}

/** Finished workouts, newest first. */
export async function listHistory(db: SQLiteDatabase, limit: number, offset = 0): Promise<Workout[]> {
  const ids = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM workouts WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT ? OFFSET ?',
    limit,
    offset,
  );
  const workouts = await Promise.all(ids.map((r) => getWorkout(db, r.id)));
  return workouts.filter((w): w is Workout => w != null);
}

export async function workoutCaloriesForDay(db: SQLiteDatabase, date: string): Promise<number> {
  const row = await db.getFirstAsync<{ kcal: number | null }>(
    'SELECT SUM(calories) AS kcal FROM workouts WHERE date = ? AND finished_at IS NOT NULL',
    date,
  );
  return row?.kcal ?? 0;
}

export async function deleteWorkout(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM workouts WHERE id = ?', id);
}

// ---------------------------------------------------------------- calendar & aggregates

/** `colors` holds one routine color slot per workout that day, in order (null = free workout). */
export type DaySummary = { date: string; workouts: number; colors: (number | null)[] };

export async function listTrainingDays(db: SQLiteDatabase): Promise<DaySummary[]> {
  const rows = await db.getAllAsync<{ date: string; workouts: number; colors: string }>(
    `SELECT date, COUNT(*) AS workouts, GROUP_CONCAT(color) AS colors FROM (
       SELECT w.date, COALESCE(r.color, -1) AS color
       FROM workouts w LEFT JOIN routines r ON r.id = w.routine_id
       WHERE w.finished_at IS NOT NULL ORDER BY w.started_at
     ) GROUP BY date`,
  );
  return rows.map((r) => ({
    date: r.date,
    workouts: r.workouts,
    colors: r.colors.split(',').map((c) => (c === '-1' ? null : Number(c))),
  }));
}

export async function getWorkoutsForDay(db: SQLiteDatabase, date: string): Promise<Workout[]> {
  const ids = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM workouts WHERE date = ? AND finished_at IS NOT NULL ORDER BY started_at',
    date,
  );
  const workouts = await Promise.all(ids.map((r) => getWorkout(db, r.id)));
  return workouts.filter((w): w is Workout => w != null);
}

export type WeekVolume = { weekStart: string; volume: number; workouts: number };

/** Total lifted volume (kg × reps) per week, including empty weeks, oldest first. */
export async function weeklyVolume(db: SQLiteDatabase, weeks: number): Promise<WeekVolume[]> {
  const first = startOfWeek(addDays(new Date(), -7 * (weeks - 1)));
  const rows = await db.getAllAsync<{ date: string; workoutId: number; volume: number }>(
    `SELECT w.date, w.id AS workoutId, COALESCE(SUM(s.weight * s.reps), 0) AS volume
     FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id AND s.completed = 1
     WHERE w.finished_at IS NOT NULL AND w.date >= ?
     GROUP BY w.id`,
    toDayKey(first),
  );
  const buckets: WeekVolume[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: toDayKey(addDays(first, 7 * i)),
    volume: 0,
    workouts: 0,
  }));
  for (const r of rows) {
    // Round the day difference to absorb DST shifts before bucketing by week.
    const days = Math.round((fromDayKey(r.date).getTime() - first.getTime()) / 86_400_000);
    const i = Math.floor(days / 7);
    if (i >= 0 && i < weeks) {
      buckets[i].volume += r.volume;
      buckets[i].workouts += 1;
    }
  }
  return buckets;
}

export type MonthCount = { month: string; workouts: number };

export async function monthlyWorkouts(db: SQLiteDatabase, months: number): Promise<MonthCount[]> {
  const now = new Date();
  const keys = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return toDayKey(d).slice(0, 7);
  });
  const rows = await db.getAllAsync<MonthCount>(
    `SELECT substr(date, 1, 7) AS month, COUNT(*) AS workouts FROM workouts
     WHERE finished_at IS NOT NULL AND date >= ? GROUP BY month`,
    `${keys[0]}-01`,
  );
  return keys.map((month) => ({ month, workouts: rows.find((r) => r.month === month)?.workouts ?? 0 }));
}

// ---------------------------------------------------------------- settings

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}
