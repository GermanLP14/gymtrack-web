import Anthropic from '@anthropic-ai/sdk';
import type { SQLiteDatabase } from 'expo-sqlite';

import { ROUTINE_COLOR_COUNT } from '@/constants/theme';
import { AiError, getApiKey, toAiError } from './ai';
import { getEffectiveProfile, getTargetWeight, listWeights } from './body';
import { toDayKey } from './dates';
import { capitalize, getExercise, searchExercises } from './exercisedb';
import type { ProgressionTarget } from './progression';
import {
  getCoachOverview,
  getExerciseSessions,
  getRecommendation,
  getRoutine,
  listHistory,
  listRoutines,
  listTrackedExercises,
  monthlyWorkouts,
  saveRoutine,
  weeklyVolume,
  type Routine,
} from './repo';
import { formatKg, sessionMetrics } from './stats';

/**
 * Chat coach: Claude with read access to the user's routines and training log,
 * and one write tool. Every routine change goes through `propose_routine_change`,
 * which shows the change to the user and waits for an explicit yes before saving.
 */

export const COACH_MODEL = 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 12;

export type ProposedExercise = ProgressionTarget & { exerciseId: string; name: string; restSec: number };

export type RoutineProposal = {
  routineId: number | null;
  name: string;
  color: number;
  exercises: ProposedExercise[];
  /** Claude's one-line reason for the change, shown above the diff. */
  summary: string;
  /** Human-readable change list, e.g. "+ Remo con barra 3 × 8–12". */
  changes: { kind: 'add' | 'remove' | 'change' | 'info'; text: string }[];
};

export type CoachEvent =
  | { type: 'text'; text: string }
  | { type: 'activity'; text: string };

export type CoachCallbacks = {
  onEvent: (e: CoachEvent) => void;
  /** Resolves true only if the user approved the change. */
  confirm: (proposal: RoutineProposal) => Promise<boolean>;
  /** Lets the caller drop a turn that was superseded (e.g. "Nueva conversación"). */
  isCancelled: () => boolean;
};

const SYSTEM = `Sos el coach de Plitt Fit, una app para registrar entrenamientos de fuerza. Conversás con el usuario sobre sus rutinas, los pesos que levanta y su progreso.

Cómo responder:
- Español rioplatense, cercano y concreto. Respuestas cortas; texto plano sin markdown (sin asteriscos ni títulos). Para listas usá guiones.
- Antes de opinar sobre datos del usuario, consultalos con las herramientas. No inventes pesos, fechas ni números.
- Los ejercicios se identifican por exercise_id; mostrale al usuario solo los nombres.

Cómo funciona la progresión en la app: cada ejercicio de una rutina tiene series objetivo, un rango de repeticiones (rep_min a rep_max), un incremento de peso y un descanso. Es doble progresión: cuando todas las series llegan a rep_max con esfuerzo manejable se sube el incremento; si no llega a rep_min dos veces seguidas se baja ~10 %; tres sesiones sin mejorar el 1RM estimado sugieren una descarga.

Cambios en rutinas:
- Para modificar una rutina o crear una nueva usá propose_routine_change. Esa herramienta le muestra los cambios al usuario y le pide confirmación; nada se guarda hasta que confirme.
- Podés proponer cambios por iniciativa propia cuando los datos lo justifiquen (estancamientos, volumen desbalanceado, rangos mal elegidos), o porque el usuario lo pidió. Explicá brevemente el motivo.
- La herramienta reemplaza la lista completa de ejercicios: incluí todos los que deben quedar, en orden, y copiá sin cambios los valores de los que no tocás.
- Para agregar un ejercicio nuevo, buscalo primero con search_exercises y usá su exercise_id.
- Solo decí que un cambio quedó aplicado si la herramienta lo confirma. Si el usuario lo rechaza, preguntale qué prefiere en vez de insistir.

Si el usuario menciona dolor o una lesión, sugerí bajar la carga y consultar a un profesional de la salud antes de seguir.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_routines',
    description:
      'Lista todas las rutinas del usuario con sus ejercicios en orden, y para cada uno: exercise_id, nombre, series objetivo, rango de repeticiones, incremento de peso (kg) y descanso (segundos). También la fecha en que se hizo cada rutina por última vez.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_training_overview',
    description:
      'Resumen del entrenamiento: volumen semanal de las últimas 8 semanas, entrenamientos por mes, ejercicios registrados (con exercise_id, cantidad de sesiones y última fecha), la recomendación del coach automático para los ejercicios recientes, perfil corporal y registros de peso corporal.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_exercise_progress',
    description:
      'Historial de un ejercicio: cada sesión con fecha y series (peso × reps), el 1RM estimado y la recomendación para la próxima sesión. Si se pasa routine_id, solo cuenta las sesiones hechas dentro de esa rutina.',
    input_schema: {
      type: 'object',
      properties: {
        exercise_id: { type: 'string' },
        routine_id: { type: 'integer', description: 'Opcional: limita el historial a una rutina.' },
      },
      required: ['exercise_id'],
    },
  },
  {
    name: 'get_recent_workouts',
    description: 'Los últimos entrenamientos terminados, con rutina, fecha, duración y las series de cada ejercicio.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Cuántos entrenamientos (1 a 10). Por defecto 5.' } },
    },
  },
  {
    name: 'search_exercises',
    description:
      'Busca ejercicios por nombre para obtener su exercise_id. Primero busca en los ejercicios ya guardados en la app (nombres en español o inglés) y después en la base ExerciseDB, cuyos nombres están en inglés: si no aparece nada, probá con el nombre en inglés (por ejemplo "barbell row").',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'propose_routine_change',
    description:
      'Propone modificar una rutina existente (routine_id) o crear una nueva (routine_id null). Reemplaza la lista completa de ejercicios. El usuario ve los cambios y debe confirmarlos; el resultado indica si los aceptó y se guardaron, o si los rechazó.',
    input_schema: {
      type: 'object',
      properties: {
        routine_id: { type: ['integer', 'null'], description: 'Rutina a modificar, o null para crear una nueva.' },
        name: { type: 'string', description: 'Nombre de la rutina (el actual si no cambia).' },
        summary: { type: 'string', description: 'Una oración para el usuario explicando qué cambia y por qué.' },
        exercises: {
          type: 'array',
          description: 'Lista completa y ordenada de ejercicios que debe tener la rutina.',
          items: {
            type: 'object',
            properties: {
              exercise_id: { type: 'string' },
              target_sets: { type: 'integer' },
              rep_min: { type: 'integer' },
              rep_max: { type: 'integer' },
              increment_kg: { type: 'number' },
              rest_sec: { type: 'integer' },
            },
            required: ['exercise_id', 'target_sets', 'rep_min', 'rep_max', 'increment_kg', 'rest_sec'],
          },
        },
      },
      required: ['routine_id', 'name', 'summary', 'exercises'],
    },
  },
];

const ACTIVITY: Record<string, string> = {
  list_routines: 'Revisando tus rutinas…',
  get_training_overview: 'Mirando tu resumen de entrenamiento…',
  get_exercise_progress: 'Analizando el progreso del ejercicio…',
  get_recent_workouts: 'Leyendo tus últimos entrenamientos…',
  search_exercises: 'Buscando ejercicios…',
  propose_routine_change: 'Preparando el cambio de rutina…',
};

/** Tool failures go back to Claude as `is_error` results so it can correct itself. */
class ToolInputError extends Error {}

/**
 * Runs one user turn: sends `messages` (already ending with the user's message),
 * executes tool calls, and appends every assistant/tool turn to `messages` in place.
 */
export async function runCoachTurn(db: SQLiteDatabase, messages: Anthropic.Beta.BetaMessageParam[], cb: CoachCallbacks) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new AiError('Cargá tu API key de Anthropic en Ajustes para usar el coach.');

  // The key belongs to whoever uses this app and only ever goes to the Anthropic API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const system = `${SYSTEM}\n\nHoy es ${toDayKey(new Date())}.`;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: COACH_MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        // Caches the growing conversation, so each follow-up only pays for the new part.
        cache_control: { type: 'ephemeral' },
        // If the model declines, the API re-runs the request on a recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        tools: TOOLS,
        messages,
      });
    } catch (e) {
      throw toAiError(e);
    }
    if (cb.isCancelled()) return;

    if (response.stop_reason === 'refusal') {
      throw new AiError('El coach no puede responder a eso. Probá preguntarlo de otra forma.');
    }
    // Thinking blocks must go back unchanged, so the whole content is stored.
    messages.push({ role: 'assistant', content: response.content });

    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    if (text) cb.onEvent({ type: 'text', text });

    if (response.stop_reason === 'pause_turn') continue;
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (calls.length === 0) return;
    if (response.stop_reason === 'max_tokens') {
      throw new AiError('La respuesta del coach quedó cortada. Probá pedirlo en partes más chicas.');
    }

    // Reads run in parallel; a proposal waits for the user, so run those one at a time after.
    const results = new Map<string, Anthropic.Beta.BetaToolResultBlockParam>();
    const reads = calls.filter((c) => c.name !== 'propose_routine_change');
    const writes = calls.filter((c) => c.name === 'propose_routine_change');
    for (const name of new Set(calls.map((c) => c.name))) cb.onEvent({ type: 'activity', text: ACTIVITY[name] ?? 'Consultando…' });
    await Promise.all(reads.map(async (c) => results.set(c.id, await runTool(db, c, cb))));
    for (const c of writes) {
      if (cb.isCancelled()) return;
      results.set(c.id, await runTool(db, c, cb));
    }
    if (cb.isCancelled()) return;
    // All results in one user message, in the order the calls were made.
    messages.push({ role: 'user', content: calls.map((c) => results.get(c.id)!) });
  }
  throw new AiError('El coach hizo demasiadas consultas seguidas. Probá reformular la pregunta.');
}

async function runTool(
  db: SQLiteDatabase,
  call: Anthropic.Beta.BetaToolUseBlock,
  cb: CoachCallbacks,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  try {
    const input = (call.input ?? {}) as Record<string, unknown>;
    const content = await executeTool(db, call.name, input, cb);
    return { type: 'tool_result', tool_use_id: call.id, content };
  } catch (e) {
    const message = e instanceof ToolInputError || e instanceof Error ? e.message : String(e);
    return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: message };
  }
}

async function executeTool(db: SQLiteDatabase, name: string, input: Record<string, unknown>, cb: CoachCallbacks) {
  switch (name) {
    case 'list_routines':
      return JSON.stringify(await routinesForClaude(db));
    case 'get_training_overview':
      return JSON.stringify(await trainingOverview(db));
    case 'get_exercise_progress':
      return JSON.stringify(
        await exerciseProgress(db, requireString(input.exercise_id, 'exercise_id'), optionalInt(input.routine_id)),
      );
    case 'get_recent_workouts':
      return JSON.stringify(await recentWorkouts(db, clamp(optionalInt(input.limit) ?? 5, 1, 10)));
    case 'search_exercises':
      return JSON.stringify(await findExercises(db, requireString(input.query, 'query')));
    case 'propose_routine_change':
      return proposeRoutineChange(db, input, cb);
    default:
      throw new ToolInputError(`Herramienta desconocida: ${name}`);
  }
}

// ---------------------------------------------------------------- read tools

function exerciseForClaude(e: ProgressionTarget & { exerciseId: string; name: string; restSec: number }) {
  return {
    exercise_id: e.exerciseId,
    name: capitalize(e.name),
    target_sets: e.targetSets,
    rep_min: e.repMin,
    rep_max: e.repMax,
    increment_kg: e.incrementKg,
    rest_sec: e.restSec,
  };
}

async function routinesForClaude(db: SQLiteDatabase) {
  const summaries = await listRoutines(db);
  const routines = await Promise.all(summaries.map((s) => getRoutine(db, s.id)));
  return summaries.map((s, i) => ({
    routine_id: s.id,
    name: s.name,
    last_done: s.lastDone,
    exercises: (routines[i]?.exercises ?? []).map(exerciseForClaude),
  }));
}

async function trainingOverview(db: SQLiteDatabase) {
  const [weeks, months, tracked, coach, profile, weights, targetWeight] = await Promise.all([
    weeklyVolume(db, 8),
    monthlyWorkouts(db, 6),
    listTrackedExercises(db),
    getCoachOverview(db),
    getEffectiveProfile(db),
    listWeights(db),
    getTargetWeight(db),
  ]);
  return {
    weekly_volume_kg: weeks.map((w) => ({ week_start: w.weekStart, volume: Math.round(w.volume), workouts: w.workouts })),
    workouts_per_month: months,
    tracked_exercises: tracked.map((t) => ({ exercise_id: t.id, name: capitalize(t.name), sessions: t.sessions, last_date: t.lastDate })),
    coach_recommendations: coach.map((c) => ({
      exercise_id: c.exerciseId,
      name: capitalize(c.name),
      action: c.recommendation.action,
      next: c.recommendation.title,
      reason: c.recommendation.reason,
    })),
    profile,
    body_weight: { target_kg: targetWeight, recent: weights.slice(0, 12).map((w) => ({ date: w.date, kg: w.weight })) },
  };
}

async function exerciseProgress(db: SQLiteDatabase, exerciseId: string, routineId: number | null) {
  const sessions = await getExerciseSessions(db, exerciseId, routineId != null ? { routineId } : {});
  const rec = await getRecommendation(db, exerciseId, undefined, routineId);
  return {
    sessions: sessions.slice(-15).map((s) => {
      const m = sessionMetrics(s.sets);
      return {
        date: s.date,
        sets: s.sets.map((x) => `${x.weight}×${x.reps}${x.rpe != null ? ` @RPE${x.rpe}` : ''}`).join(', '),
        best_e1rm_kg: Math.round(m.bestE1rm * 10) / 10,
      };
    }),
    total_sessions: sessions.length,
    next_session: { action: rec.action, plan: rec.title, weight: rec.weight != null ? formatKg(rec.weight) : null, reason: rec.reason },
  };
}

async function recentWorkouts(db: SQLiteDatabase, limit: number) {
  const workouts = await listHistory(db, limit);
  return workouts.map((w) => ({
    date: w.date,
    routine: w.name,
    duration_min: w.finishedAt ? Math.round((w.finishedAt - w.startedAt) / 60000) : null,
    exercises: w.exercises.map((e) => ({
      exercise_id: e.exerciseId,
      name: capitalize(e.name),
      sets: e.sets.map((s) => `${s.weight}×${s.reps}`).join(', '),
    })),
  }));
}

async function findExercises(db: SQLiteDatabase, query: string) {
  const like = `%${query.trim()}%`;
  const local = await db.getAllAsync<{ id: string; name: string; nameEs: string | null; bodyParts: string; equipments: string }>(
    `SELECT id, name, name_es AS nameEs, body_parts AS bodyParts, equipments FROM exercises
     WHERE name LIKE ? OR name_es LIKE ? ORDER BY cached_at DESC LIMIT 15`,
    like,
    like,
  );
  const results = local.map((e) => ({
    exercise_id: e.id,
    name: capitalize(e.nameEs ?? e.name),
    body_parts: JSON.parse(e.bodyParts) as string[],
    equipment: JSON.parse(e.equipments) as string[],
  }));
  if (results.length < 5) {
    try {
      const page = await searchExercises(db, { name: query });
      for (const e of page.items) {
        if (results.some((r) => r.exercise_id === e.id)) continue;
        results.push({ exercise_id: e.id, name: capitalize(e.name), body_parts: e.bodyParts, equipment: e.equipments });
      }
    } catch {
      // ExerciseDB is optional here: the local matches are still useful.
    }
  }
  return results.slice(0, 15);
}

// ---------------------------------------------------------------- write tool

async function proposeRoutineChange(db: SQLiteDatabase, input: Record<string, unknown>, cb: CoachCallbacks): Promise<string> {
  const routineId = input.routine_id == null ? null : requireInt(input.routine_id, 'routine_id');
  const name = requireString(input.name, 'name').slice(0, 60);
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    throw new ToolInputError('exercises debe ser una lista con al menos un ejercicio.');
  }
  if (input.exercises.length > 20) throw new ToolInputError('Una rutina puede tener como máximo 20 ejercicios.');

  const current = routineId != null ? await getRoutine(db, routineId) : null;
  if (routineId != null && !current) throw new ToolInputError(`No existe una rutina con routine_id ${routineId}.`);

  const exercises: ProposedExercise[] = [];
  for (const [i, raw] of input.exercises.entries()) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const at = `exercises[${i}]`;
    const exerciseId = requireString(e.exercise_id, `${at}.exercise_id`);
    if (exercises.some((x) => x.exerciseId === exerciseId)) {
      throw new ToolInputError(`El ejercicio ${exerciseId} aparece dos veces.`);
    }
    const repMin = requireInt(e.rep_min, `${at}.rep_min`, 1, 50);
    const repMax = requireInt(e.rep_max, `${at}.rep_max`, repMin, 50);
    let exerciseName: string;
    try {
      // Also stores the exercise locally, which the routine needs once saved.
      const found = await getExercise(db, exerciseId);
      exerciseName = current?.exercises.find((x) => x.exerciseId === exerciseId)?.name ?? found.name;
    } catch {
      throw new ToolInputError(`No encontré el ejercicio ${exerciseId}. Buscalo con search_exercises.`);
    }
    exercises.push({
      exerciseId,
      name: exerciseName,
      targetSets: requireInt(e.target_sets, `${at}.target_sets`, 1, 10),
      repMin,
      repMax,
      incrementKg: requireNumber(e.increment_kg, `${at}.increment_kg`, 0, 20),
      restSec: requireInt(e.rest_sec, `${at}.rest_sec`, 0, 600),
    });
  }

  const color = current?.color ?? (await listRoutines(db)).length % ROUTINE_COLOR_COUNT;
  const changes = describeChanges(current, name, exercises);
  if (current && changes.length === 0) return 'La propuesta es igual a la rutina actual; no hay nada para cambiar.';

  const proposal: RoutineProposal = { routineId, name, color, exercises, summary, changes };
  const approved = await cb.confirm(proposal);
  if (cb.isCancelled()) return 'La conversación se cerró antes de que el usuario respondiera. No se guardó nada.';
  if (!approved) {
    return 'El usuario rechazó la propuesta. La rutina no se modificó. Preguntale qué prefiere cambiar.';
  }
  const savedId = await saveRoutine(db, {
    routineId,
    name,
    color,
    exercises: exercises.map(({ name: _name, ...rest }) => rest),
  });
  return routineId != null
    ? `El usuario confirmó. La rutina "${name}" (routine_id ${savedId}) quedó actualizada.`
    : `El usuario confirmó. Se creó la rutina "${name}" (routine_id ${savedId}).`;
}

function formatTarget(e: ProgressionTarget & { restSec: number }) {
  const reps = e.repMin === e.repMax ? `${e.repMin}` : `${e.repMin}–${e.repMax}`;
  return `${e.targetSets} × ${reps}`;
}

/** What the user sees before confirming. Compared by exercise, so a reorder is not shown as remove + add. */
export function describeChanges(current: Routine | null, name: string, next: ProposedExercise[]): RoutineProposal['changes'] {
  const changes: RoutineProposal['changes'] = [];
  if (!current) {
    for (const e of next) changes.push({ kind: 'add', text: `${capitalize(e.name)} · ${formatTarget(e)}` });
    return changes;
  }
  if (current.name !== name) changes.push({ kind: 'info', text: `Nombre: "${current.name}" → "${name}"` });

  for (const old of current.exercises) {
    if (!next.some((e) => e.exerciseId === old.exerciseId)) {
      changes.push({ kind: 'remove', text: `${capitalize(old.name)} · ${formatTarget(old)}` });
    }
  }
  for (const e of next) {
    const old = current.exercises.find((x) => x.exerciseId === e.exerciseId);
    if (!old) {
      changes.push({ kind: 'add', text: `${capitalize(e.name)} · ${formatTarget(e)}` });
      continue;
    }
    const diffs: string[] = [];
    if (formatTarget(old) !== formatTarget(e)) diffs.push(`${formatTarget(old)} → ${formatTarget(e)}`);
    if (old.incrementKg !== e.incrementKg) diffs.push(`incremento ${formatKg(old.incrementKg)} → ${formatKg(e.incrementKg)}`);
    if (old.restSec !== e.restSec) diffs.push(`descanso ${old.restSec}s → ${e.restSec}s`);
    if (diffs.length) changes.push({ kind: 'change', text: `${capitalize(e.name)}: ${diffs.join(', ')}` });
  }

  const kept = current.exercises.map((x) => x.exerciseId).filter((id) => next.some((e) => e.exerciseId === id));
  const nextOrder = next.map((e) => e.exerciseId).filter((id) => kept.includes(id));
  if (kept.join() !== nextOrder.join()) changes.push({ kind: 'info', text: 'Cambia el orden de los ejercicios' });
  return changes;
}

// ---------------------------------------------------------------- input checks

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new ToolInputError(`Falta ${field} (texto).`);
  return v.trim();
}

function requireNumber(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new ToolInputError(`${field} debe ser un número entre ${min} y ${max}.`);
  }
  return v;
}

function requireInt(v: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = requireNumber(v, field, min, max);
  if (!Number.isInteger(n)) throw new ToolInputError(`${field} debe ser un número entero.`);
  return n;
}

function optionalInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
