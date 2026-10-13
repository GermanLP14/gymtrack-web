/**
 * Calorie estimates from the user's profile. Pure functions, no I/O.
 *
 * 1 MET is the resting metabolic rate, so an activity burns MET × RMR per
 * minute. RMR comes from the Mifflin–St Jeor BMR, which is why age, height
 * and sex matter. "Active" calories subtract the resting 1 MET, so they can
 * be added to the basal metabolism without counting it twice.
 */

export type Sex = 'male' | 'female';

export type Profile = { sex: Sex; age: number; heightCm: number; weightKg: number };

/** Compendium of Physical Activities: resistance training, vigorous effort. */
const MET_STRENGTH = 5.0;
/** Workouts left open longer than this are capped (forgot to tap "Terminar"). */
const MAX_WORKOUT_MINUTES = 180;

/** Mifflin–St Jeor basal metabolic rate, kcal/day. */
export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return base + (p.sex === 'male' ? 5 : -161);
}

function activeKcal(p: Profile, met: number, minutes: number): number {
  return Math.max(0, (met - 1) * (bmr(p) / 1440) * minutes);
}

export function workoutCalories(p: Profile, durationMs: number): number {
  const minutes = Math.min(MAX_WORKOUT_MINUTES, Math.max(0, durationMs / 60000));
  return activeKcal(p, MET_STRENGTH, minutes);
}

/** Basal calories burned so far today (the part of BMR already elapsed). */
export function basalSoFar(p: Profile, now: Date): number {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return bmr(p) * (minutes / 1440);
}

export function isValidProfile(p: Partial<Profile>): p is Profile {
  return (
    (p.sex === 'male' || p.sex === 'female') &&
    typeof p.age === 'number' &&
    p.age >= 10 &&
    p.age <= 100 &&
    typeof p.heightCm === 'number' &&
    p.heightCm >= 100 &&
    p.heightCm <= 250 &&
    typeof p.weightKg === 'number' &&
    p.weightKg >= 30 &&
    p.weightKg <= 300
  );
}
