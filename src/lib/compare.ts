/**
 * Set-by-set comparison of a workout against the previous one of the same
 * routine. Pure functions; used for the history screen and as compact input
 * for the AI summary.
 */
import type { SetLog } from './stats';

export type CompareStatus = 'up' | 'same' | 'down' | 'mixed' | 'new';

export type ExerciseComparison = {
  exerciseId: string;
  name: string;
  today: SetLog[];
  previous: SetLog[] | null;
  status: CompareStatus;
};

/** -1 worse, 0 equal, 1 better: heavier wins; at equal weight, more reps wins. */
function compareSet(a: SetLog, b: SetLog): number {
  if (a.weight !== b.weight) return a.weight > b.weight ? 1 : -1;
  if (a.reps !== b.reps) return a.reps > b.reps ? 1 : -1;
  return 0;
}

export function compareExercise(today: SetLog[], previous: SetLog[] | null): CompareStatus {
  if (!previous || previous.length === 0) return 'new';
  let better = 0;
  let worse = 0;
  previous.forEach((prev, i) => {
    const cur = today[i];
    const c = cur ? compareSet(cur, prev) : -1; // a missing set counts as not replicated
    if (c > 0) better++;
    else if (c < 0) worse++;
  });
  if (today.length > previous.length) better++;
  if (worse === 0) return better > 0 ? 'up' : 'same';
  return better > 0 ? 'mixed' : 'down';
}

type WorkoutLike = { exercises: { exerciseId: string; name: string; sets: SetLog[] }[] };

export function compareWorkouts(today: WorkoutLike, previous: WorkoutLike | null): ExerciseComparison[] {
  return today.exercises.map((ex) => {
    const prev = previous?.exercises.find((p) => p.exerciseId === ex.exerciseId)?.sets ?? null;
    return { exerciseId: ex.exerciseId, name: ex.name, today: ex.sets, previous: prev, status: compareExercise(ex.sets, prev) };
  });
}

export function formatSets(sets: SetLog[]): string {
  return sets.map((s) => `${s.weight}×${s.reps}`).join(', ');
}
