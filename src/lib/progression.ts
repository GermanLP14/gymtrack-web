/**
 * Progressive-overload coach.
 *
 * Rule-based "double progression" with RPE autoregulation, evaluated locally:
 *  1. Work inside a rep range (e.g. 8–12) at a fixed weight.
 *  2. When every target set reaches the top of the range at a manageable effort,
 *     add weight and drop back to the bottom of the range.
 *  3. Missing the bottom of the range once means repeat; twice in a row at the
 *     same weight means the load is too heavy, so it comes down ~10 %.
 *  4. Three sessions without improving the estimated 1RM triggers a deload.
 */
import { averageRpe, formatKg, roundTo, sessionMetrics, type ExerciseSession, type SetLog } from './stats';

export type ProgressionTarget = {
  targetSets: number;
  repMin: number;
  repMax: number;
  incrementKg: number;
};

export const DEFAULT_TARGET: ProgressionTarget = { targetSets: 3, repMin: 8, repMax: 12, incrementKg: 2.5 };

export type CoachAction = 'start' | 'increase' | 'hold' | 'decrease' | 'deload';

export type Recommendation = {
  action: CoachAction;
  /** Suggested working weight for next session; null when there is no history. */
  weight: number | null;
  reps: number;
  sets: number;
  title: string;
  reason: string;
};

/** RPE at or below this counts as "had reps left" and allows a weight increase. */
const MAX_RPE_TO_PROGRESS = 9;
/** Average RPE at or above this means the set was a true grinder. */
const GRINDER_RPE = 9.5;
const STALL_SESSIONS = 3;
const DECREASE_FACTOR = 0.9;

/** The heaviest sets of a session; lighter warm-up/back-off sets are ignored. */
function workingSets(sets: SetLog[]): SetLog[] {
  const top = Math.max(...sets.map((s) => s.weight));
  return sets.filter((s) => s.weight >= top * 0.975);
}

function weightStep(target: ProgressionTarget): number {
  return target.incrementKg > 0 ? Math.min(target.incrementKg, 2.5) : 0.5;
}

function lowerWeight(weight: number, target: ProgressionTarget): number {
  const step = weightStep(target);
  let next = roundTo(weight * DECREASE_FACTOR, step);
  if (next >= weight) next = weight - step;
  return Math.max(0, next);
}

function missedBottom(sets: SetLog[], target: ProgressionTarget): boolean {
  return sets.some((s) => s.reps < target.repMin);
}

function isStalled(sessions: ExerciseSession[]): boolean {
  if (sessions.length < STALL_SESSIONS + 1) return false;
  const reference = sessionMetrics(sessions[sessions.length - STALL_SESSIONS - 1].sets).bestE1rm;
  const recent = sessions.slice(-STALL_SESSIONS).map((s) => sessionMetrics(s.sets).bestE1rm);
  return reference > 0 && Math.max(...recent) <= reference;
}

/**
 * @param sessions completed sessions of one exercise, oldest first.
 */
export function recommend(sessions: ExerciseSession[], target: ProgressionTarget = DEFAULT_TARGET): Recommendation {
  const history = sessions.filter((s) => s.sets.length > 0);
  const { targetSets, repMin, repMax, incrementKg } = target;

  if (history.length === 0) {
    return {
      action: 'start',
      weight: null,
      reps: repMax,
      sets: targetSets,
      title: 'Primera sesión',
      reason: `Elegí un peso con el que llegues a ${repMax} reps dejando 2–3 en reserva (RPE 7–8). Con esa sesión ya puedo recomendarte cómo progresar.`,
    };
  }

  const last = history[history.length - 1];
  const work = workingSets(last.sets);
  const weight = work[0].weight;
  const rpe = averageRpe(work);
  const minReps = Math.min(...work.map((s) => s.reps));
  const bodyweight = weight === 0;

  // Bodyweight exercises progress by reps; weight only once reps are well past the range.
  if (bodyweight) {
    const allTop = work.length >= targetSets && minReps >= repMax;
    return allTop
      ? {
          action: 'increase',
          weight: incrementKg,
          reps: repMin,
          sets: targetSets,
          title: 'Agregá lastre',
          reason: `Completaste ${work.length}×${minReps}+ con tu peso corporal. Sumá ${formatKg(incrementKg)} de lastre (o una variante más difícil) y volvé a ${repMin} reps.`,
        }
      : {
          action: 'hold',
          weight: 0,
          reps: Math.min(repMax, minReps + 1),
          sets: targetSets,
          title: 'Sumá repeticiones',
          reason: `Buscá ${Math.min(repMax, minReps + 1)} reps en cada serie. Cuando hagas ${targetSets}×${repMax} te recomiendo agregar lastre.`,
        };
  }

  if (missedBottom(work, target)) {
    const prev = history.length > 1 ? history[history.length - 2] : null;
    const prevWork = prev ? workingSets(prev.sets) : null;
    const missedTwice = prevWork != null && prevWork[0].weight === weight && missedBottom(prevWork, target);
    if (missedTwice) {
      const next = lowerWeight(weight, target);
      return {
        action: 'decrease',
        weight: next,
        reps: repMax,
        sets: targetSets,
        title: `Bajá a ${formatKg(next)}`,
        reason: `Dos sesiones seguidas con ${formatKg(weight)} quedaste por debajo de ${repMin} reps. Bajar ~10 % te deja acumular reps de calidad y volver a pasar este peso.`,
      };
    }
    return {
      action: 'hold',
      weight,
      reps: repMin,
      sets: targetSets,
      title: `Repetí ${formatKg(weight)}`,
      reason: `La última vez no llegaste a ${repMin} reps en todas las series. Repetí el peso; si vuelve a pasar, te recomiendo bajarlo.`,
    };
  }

  const hitTop = work.length >= targetSets && minReps >= repMax;
  if (hitTop) {
    if (rpe != null && rpe > MAX_RPE_TO_PROGRESS) {
      return {
        action: 'hold',
        weight,
        reps: repMax,
        sets: targetSets,
        title: `Consolidá ${formatKg(weight)}`,
        reason: `Llegaste a ${repMax} reps pero al límite (RPE ${rpe.toFixed(1)}). Repetí hasta que se sienta RPE ≤ ${MAX_RPE_TO_PROGRESS} antes de subir.`,
      };
    }
    // Lots of reps left in the tank: a double jump avoids wasting sessions.
    const easy = rpe != null && rpe <= 7 && minReps >= repMax + 2;
    const next = weight + incrementKg * (easy ? 2 : 1);
    return {
      action: 'increase',
      weight: next,
      reps: repMin,
      sets: targetSets,
      title: `Subí a ${formatKg(next)}`,
      reason: easy
        ? `Hiciste ${work.length}×${minReps}+ con ${formatKg(weight)} y te sobró mucho (RPE ${rpe!.toFixed(1)}). Subí el doble del incremento y trabajá en ${repMin}–${repMax} reps.`
        : `Completaste ${targetSets}×${repMax} con ${formatKg(weight)}${rpe != null ? ` a RPE ${rpe.toFixed(1)}` : ''}. Sumá ${formatKg(incrementKg)} y volvé a ${repMin} reps.`,
    };
  }

  if (isStalled(history)) {
    const next = lowerWeight(weight, target);
    return {
      action: 'deload',
      weight: next,
      reps: repMax,
      sets: targetSets,
      title: `Descarga: ${formatKg(next)}`,
      reason: `Tu 1RM estimado no mejora hace ${STALL_SESSIONS} sesiones (${formatKg(sessionMetrics(last.sets).bestE1rm)}). Una semana más liviana ayuda a recuperar y romper el estancamiento.`,
    };
  }

  if (rpe != null && rpe >= GRINDER_RPE) {
    return {
      action: 'hold',
      weight,
      reps: minReps,
      sets: targetSets,
      title: `Mantené ${formatKg(weight)}`,
      reason: `Las series fueron muy exigentes (RPE ${rpe.toFixed(1)}). Repetí las mismas reps buscando que se sientan más fáciles.`,
    };
  }

  const nextReps = Math.min(repMax, minReps + 1);
  return {
    action: 'hold',
    weight,
    reps: nextReps,
    sets: targetSets,
    title: `Mantené ${formatKg(weight)}`,
    reason: `Estás dentro del rango (${minReps} reps). Buscá ${nextReps} reps por serie; al llegar a ${targetSets}×${repMax} te aviso para subir.`,
  };
}

/** Trend of the estimated 1RM across the given sessions, for the "rendimiento" readout. */
export function e1rmTrend(sessions: ExerciseSession[]): number | null {
  const values = sessions.map((s) => sessionMetrics(s.sets).bestE1rm).filter((v) => v > 0);
  if (values.length < 2) return null;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}
