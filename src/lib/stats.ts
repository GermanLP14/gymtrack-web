/** Pure training metrics. No database or React code here. */

export type SetLog = { weight: number; reps: number; rpe: number | null };

export type ExerciseSession = {
  workoutId: number;
  date: string; // YYYY-MM-DD
  sets: SetLog[]; // completed sets only, in order
};

/** Estimated one-rep max (Epley). Past ~12 reps the estimate stops being meaningful. */
export function e1rm(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + Math.min(reps, 12) / 30);
}

export type SessionMetrics = {
  maxWeight: number;
  bestE1rm: number;
  volume: number; // Σ weight × reps
  maxReps: number;
  totalReps: number;
};

export function sessionMetrics(sets: SetLog[]): SessionMetrics {
  let maxWeight = 0;
  let bestE1rm = 0;
  let volume = 0;
  let maxReps = 0;
  let totalReps = 0;
  for (const s of sets) {
    maxWeight = Math.max(maxWeight, s.weight);
    bestE1rm = Math.max(bestE1rm, e1rm(s.weight, s.reps));
    volume += s.weight * s.reps;
    maxReps = Math.max(maxReps, s.reps);
    totalReps += s.reps;
  }
  return { maxWeight, bestE1rm, volume, maxReps, totalReps };
}

export function averageRpe(sets: SetLog[]): number | null {
  const values = sets.map((s) => s.rpe).filter((r): r is number => r != null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Percent change between the first and last value, or null when not computable. */
export function percentChange(first: number, last: number): number | null {
  if (first <= 0) return null;
  return ((last - first) / first) * 100;
}

export function roundTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export function formatKg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} kg`;
}

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('es-AR');
}

/** "11-13 repeticiones", or "15 repeticiones" when the range is a single value. */
export function formatRepRange(repMin: number, repMax: number): string {
  return `${repMin === repMax ? repMin : `${repMin}-${repMax}`} repeticiones`;
}

/** Rest time as "1min 30s". */
export function formatRest(sec: number): string {
  return `${Math.floor(sec / 60)}min ${sec % 60}s`;
}
