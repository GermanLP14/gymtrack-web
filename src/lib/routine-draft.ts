import { useSyncExternalStore } from 'react';

import type { Exercise } from './exercisedb';

/**
 * In-memory draft of the routine being created or edited. Nothing reaches the
 * database until the user taps "Guardar"; the exercise picker adds to this
 * draft instead of writing to SQLite.
 */
export type DraftExercise = {
  key: string;
  exerciseId: string;
  name: string;
  gifUrl: string | null;
  targetSets: number;
  repMin: number;
  repMax: number;
  incrementKg: number;
  restSec: number;
};

export type RoutineDraft = { routineId: number | null; name: string; color: number; exercises: DraftExercise[] };

let draft: RoutineDraft | null = null;
let snapshot = '';
let nextKey = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function newDraftKey(): string {
  return `d${nextKey++}`;
}

export function beginDraft(d: RoutineDraft) {
  draft = d;
  snapshot = JSON.stringify(d);
  emit();
}

export function clearDraft() {
  draft = null;
  snapshot = '';
  emit();
}

export function updateDraft(fn: (d: RoutineDraft) => RoutineDraft) {
  if (!draft) return;
  draft = fn(draft);
  emit();
}

export function isDraftDirty(): boolean {
  return draft != null && JSON.stringify(draft) !== snapshot;
}

export function addExerciseToDraft(e: Exercise) {
  updateDraft((d) => ({
    ...d,
    exercises: [
      ...d.exercises,
      {
        key: newDraftKey(),
        exerciseId: e.id,
        name: e.name,
        gifUrl: e.gifUrl,
        targetSets: 3,
        repMin: 8,
        repMax: 12,
        incrementKg: 2.5,
        restSec: 90,
      },
    ],
  }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoutineDraft(): RoutineDraft | null {
  return useSyncExternalStore(subscribe, () => draft);
}
