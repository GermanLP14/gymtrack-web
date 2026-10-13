import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Client for the free ExerciseDB v1 API (https://oss.exercisedb.dev/docs).
 * The public API is rate limited, so every response is cached in SQLite and
 * exercises the user picks are stored permanently in the `exercises` table.
 */
const BASE_URL = 'https://oss.exercisedb.dev/api/v1';
const PAGE_SIZE = 25; // API maximum
const LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Exercise = {
  id: string;
  name: string;
  gifUrl: string | null;
  bodyParts: string[];
  targetMuscles: string[];
  secondaryMuscles: string[];
  equipments: string[];
  instructions: string[];
};

type ApiExercise = {
  exerciseId: string;
  name: string;
  gifUrl?: string;
  bodyParts?: string[];
  targetMuscles?: string[];
  secondaryMuscles?: string[];
  equipments?: string[];
  instructions?: string[];
};

type ApiListResponse = {
  success: boolean;
  meta?: { total: number; hasNextPage: boolean; nextCursor?: string };
  data: ApiExercise[];
};

export type ExercisePage = { items: Exercise[]; nextCursor: string | null };

export class ExerciseApiError extends Error {}

function fromApi(e: ApiExercise): Exercise {
  return {
    id: e.exerciseId,
    name: e.name,
    gifUrl: e.gifUrl ?? null,
    bodyParts: e.bodyParts ?? [],
    targetMuscles: e.targetMuscles ?? [],
    secondaryMuscles: e.secondaryMuscles ?? [],
    equipments: e.equipments ?? [],
    // The API prefixes every step with "Step:N "; the UI numbers them itself.
    instructions: (e.instructions ?? []).map((s) => s.replace(/^Step:\s*\d+\s*/i, '')),
  };
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`);
  } catch {
    throw new ExerciseApiError('Sin conexión. Revisá tu internet e intentá de nuevo.');
  }
  if (res.status === 429 || res.status === 403) {
    throw new ExerciseApiError('La API de ejercicios limitó las consultas. Esperá un minuto e intentá de nuevo.');
  }
  if (!res.ok) throw new ExerciseApiError(`Error de la API de ejercicios (${res.status}).`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Cloudflare returns a plain-text "error code: 1015" when rate limiting.
    throw new ExerciseApiError('La API de ejercicios limitó las consultas. Esperá un minuto e intentá de nuevo.');
  }
}

async function readCache<T>(db: SQLiteDatabase, key: string, ttlMs: number): Promise<T | null> {
  const row = await db.getFirstAsync<{ value: string; cached_at: number }>(
    'SELECT value, cached_at FROM api_cache WHERE key = ?',
    key,
  );
  if (!row || Date.now() - row.cached_at > ttlMs) return null;
  return JSON.parse(row.value) as T;
}

async function writeCache(db: SQLiteDatabase, key: string, value: unknown) {
  await db.runAsync(
    'INSERT OR REPLACE INTO api_cache (key, value, cached_at) VALUES (?, ?, ?)',
    key,
    JSON.stringify(value),
    Date.now(),
  );
}

export async function saveExercise(db: SQLiteDatabase, e: Exercise) {
  await db.runAsync(
    // Upsert rather than replace so a Spanish `name_es` set by the seed survives.
    `INSERT INTO exercises
       (id, name, gif_url, body_parts, target_muscles, secondary_muscles, equipments, instructions, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, gif_url = excluded.gif_url, body_parts = excluded.body_parts,
       target_muscles = excluded.target_muscles, secondary_muscles = excluded.secondary_muscles,
       equipments = excluded.equipments, instructions = excluded.instructions, cached_at = excluded.cached_at`,
    e.id,
    e.name,
    e.gifUrl,
    JSON.stringify(e.bodyParts),
    JSON.stringify(e.targetMuscles),
    JSON.stringify(e.secondaryMuscles),
    JSON.stringify(e.equipments),
    JSON.stringify(e.instructions),
    Date.now(),
  );
}

type ExerciseRow = {
  id: string;
  name: string;
  name_es: string | null;
  gif_url: string | null;
  body_parts: string;
  target_muscles: string;
  secondary_muscles: string;
  equipments: string;
  instructions: string;
};

function fromRow(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    name: r.name_es ?? r.name,
    gifUrl: r.gif_url,
    bodyParts: JSON.parse(r.body_parts),
    targetMuscles: JSON.parse(r.target_muscles),
    secondaryMuscles: JSON.parse(r.secondary_muscles),
    equipments: JSON.parse(r.equipments),
    instructions: JSON.parse(r.instructions),
  };
}

export async function getLocalExercise(db: SQLiteDatabase, id: string): Promise<Exercise | null> {
  const row = await db.getFirstAsync<ExerciseRow>('SELECT * FROM exercises WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

/** Exercises already saved on the device, most recently used first. */
export async function listLocalExercises(db: SQLiteDatabase, limit = 50): Promise<Exercise[]> {
  const rows = await db.getAllAsync<ExerciseRow>('SELECT * FROM exercises ORDER BY cached_at DESC LIMIT ?', limit);
  return rows.map(fromRow);
}

/** Returns the exercise from the local store, fetching and storing it if missing. */
export async function getExercise(db: SQLiteDatabase, id: string): Promise<Exercise> {
  const local = await getLocalExercise(db, id);
  if (local) return local;
  const res = await getJson<{ success: boolean; data: ApiExercise }>(`/exercises/${encodeURIComponent(id)}`);
  const e = fromApi(res.data);
  await saveExercise(db, e);
  return e;
}

/** Searches ExerciseDB by name and/or body part, one page at a time. */
export async function searchExercises(
  db: SQLiteDatabase,
  opts: { name?: string; bodyPart?: string; cursor?: string | null },
): Promise<ExercisePage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  const name = opts.name?.trim();
  if (name) params.set('name', name);
  if (opts.bodyPart) params.set('bodyParts', opts.bodyPart);
  if (opts.cursor) params.set('after', opts.cursor);
  const path = `/exercises?${params.toString()}`;

  const cached = await readCache<ExercisePage>(db, path, LIST_TTL_MS);
  if (cached) return cached;

  const res = await getJson<ApiListResponse>(path);
  const page: ExercisePage = {
    items: res.data.map(fromApi),
    nextCursor: res.meta?.hasNextPage ? (res.meta.nextCursor ?? null) : null,
  };
  await writeCache(db, path, page);
  return page;
}

export async function getBodyParts(db: SQLiteDatabase): Promise<string[]> {
  const key = '/bodyparts';
  const cached = await readCache<string[]>(db, key, 30 * LIST_TTL_MS);
  if (cached) return cached;
  const res = await getJson<{ data: { name: string }[] }>(key);
  const names = res.data.map((b) => b.name).sort();
  await writeCache(db, key, names);
  return names;
}

const BODY_PART_ES: Record<string, string> = {
  back: 'Espalda',
  cardio: 'Cardio',
  chest: 'Pecho',
  'lower arms': 'Antebrazos',
  'lower legs': 'Pantorrillas',
  neck: 'Cuello',
  shoulders: 'Hombros',
  'upper arms': 'Brazos',
  'upper legs': 'Piernas',
  waist: 'Abdomen',
};

export function bodyPartLabel(part: string): string {
  return BODY_PART_ES[part] ?? part;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
