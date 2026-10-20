import Anthropic from '@anthropic-ai/sdk';

import { formatSets, type ExerciseComparison } from './compare';
import { formatDuration } from './dates';

/**
 * Post-workout summary written by Claude. The user supplies their own Anthropic
 * API key (a claude.ai subscription cannot be used by third-party apps); it is
 * kept in this browser's localStorage, unencrypted, and sent only to the Anthropic API.
 */
const API_KEY_STORE = 'anthropic_api_key';

export type AiModel = 'claude-opus-5' | 'claude-haiku-4-5';

export const AI_MODELS: { value: AiModel; label: string; hint: string }[] = [
  { value: 'claude-opus-5', label: 'Opus 5', hint: 'Mejor calidad · aprox. USD 0,01 por resumen' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'Más barato · aprox. USD 0,002 por resumen' },
];

export async function getApiKey(): Promise<string | null> {
  return localStorage.getItem(API_KEY_STORE);
}

export async function setApiKey(key: string | null) {
  if (key) localStorage.setItem(API_KEY_STORE, key.trim());
  else localStorage.removeItem(API_KEY_STORE);
}

export class AiError extends Error {}

const SYSTEM = `Sos un entrenador de fuerza. Recibís el entrenamiento de hoy y el anterior del mismo tipo, serie por serie (peso en kg × repeticiones).
Respondé en español rioplatense, en texto plano sin markdown, en no más de 120 palabras:
1. Una o dos oraciones con el balance de hoy frente a la vez anterior.
2. Si en algún ejercicio no se igualaron el peso y las repeticiones, 2 o 3 consejos concretos para aplicar durante la semana antes del próximo entrenamiento de este tipo (descanso, sueño, alimentación, técnica o cómo ajustar la carga). Nombrá los ejercicios.
Si todo se igualó o mejoró, felicitá brevemente y sugerí cómo seguir progresando.`;

const STATUS_LABEL: Record<ExerciseComparison['status'], string> = {
  up: 'mejoró',
  same: 'igualó',
  down: 'no igualó',
  mixed: 'mixto',
  new: 'sin dato previo',
};

/** One short line per exercise keeps the request around 200-400 input tokens. */
function buildPrompt(input: {
  routineName: string;
  date: string;
  durationMs: number;
  previousDate: string | null;
  comparisons: ExerciseComparison[];
}): string {
  const lines = input.comparisons.map(
    (c) =>
      `- ${c.name}: hoy ${formatSets(c.today)}` +
      (c.previous ? ` | antes ${formatSets(c.previous)}` : '') +
      ` (${STATUS_LABEL[c.status]})`,
  );
  return [
    `Entrenamiento: ${input.routineName}. Hoy ${input.date} (${formatDuration(input.durationMs)})` +
      (input.previousDate ? `, anterior ${input.previousDate}.` : ', sin sesión anterior.'),
    ...lines,
  ].join('\n');
}

export async function generateWorkoutSummary(model: AiModel, input: Parameters<typeof buildPrompt>[0]): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new AiError('Cargá tu API key de Anthropic en Ajustes para generar resúmenes.');

  // The key belongs to the person using this browser and never leaves it except
  // to call the API, which is the case this SDK flag exists for.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildPrompt(input) }];

  try {
    const response =
      model === 'claude-opus-5'
        ? await client.beta.messages.create({
            model,
            // Headroom for adaptive thinking; low effort keeps the actual spend small.
            max_tokens: 2000,
            output_config: { effort: 'low' },
            // If Opus declines, the API re-runs the request on a recommended fallback model.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: SYSTEM,
            messages,
          })
        : await client.beta.messages.create({ model, max_tokens: 600, system: SYSTEM, messages });

    if (response.stop_reason === 'refusal') throw new AiError('La IA no pudo generar el resumen de este entrenamiento.');
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    if (!text) throw new AiError('La IA devolvió una respuesta vacía. Probá de nuevo.');
    return text;
  } catch (e) {
    throw toAiError(e, 'Sin conexión. El resumen se puede generar más tarde.');
  }
}

/** Turns SDK errors into messages for the user; anything else is returned unchanged. */
export function toAiError(e: unknown, offlineMessage = 'Sin conexión. Revisá tu internet y probá de nuevo.'): unknown {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new AiError('La API key no es válida. Revisala en Ajustes.');
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('Tu API key no tiene permiso para usar este modelo.');
  if (e instanceof Anthropic.RateLimitError) return new AiError('Demasiadas consultas seguidas. Probá en un minuto.');
  if (e instanceof Anthropic.APIConnectionError) return new AiError(offlineMessage);
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402) return new AiError('Tu cuenta de Anthropic no tiene crédito disponible.');
    return new AiError(`Error de la API de Claude (${e.status ?? 'desconocido'}).`);
  }
  return e;
}
